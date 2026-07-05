import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { calculateTotals } from '@/lib/quoteMath';

const quoteItemSchema = z.object({
  localItemId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  price: z.number().nonnegative(),
});

const upsertQuoteSchema = z.object({
  draftId: z.string().uuid(),
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  clientPhone: z.string().optional(),
  clientAddress: z.string().optional(),
  taxRate: z.number().min(0).max(1),
  items: z.array(quoteItemSchema).min(1),
  clientUpdatedAt: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = upsertQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const totals = calculateTotals(data.items, data.taxRate);

  const existing = await prisma.quote.findUnique({ where: { draftId: data.draftId } });
  if (existing && data.clientUpdatedAt !== undefined && existing.updatedAt.getTime() > data.clientUpdatedAt) {
    return NextResponse.json({ error: 'conflict', serverUpdatedAt: existing.updatedAt }, { status: 409 });
  }

  let client = await prisma.client.findFirst({ where: { email: data.clientEmail } });
  if (!client) {
    client = await prisma.client.create({
      data: { name: data.clientName, email: data.clientEmail, phone: data.clientPhone, address: data.clientAddress },
    });
  }

  const userId = session.user.id;

  const quoteId = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.upsert({
      where: { draftId: data.draftId },
      create: {
        draftId: data.draftId,
        clientId: client.id,
        createdById: userId,
        subtotal: totals.subtotal,
        taxRate: data.taxRate,
        taxAmount: totals.taxAmount,
        total: totals.total,
      },
      update: {
        subtotal: totals.subtotal,
        taxRate: data.taxRate,
        taxAmount: totals.taxAmount,
        total: totals.total,
      },
    });

    // Reconcile items by localItemId instead of delete-all-recreate, so QuoteItem.id
    // stays stable across resyncs and previously uploaded QuotePhoto rows are never
    // orphaned by their QuoteItem's onDelete: Cascade.
    const existingItems = await tx.quoteItem.findMany({ where: { quoteId: quote.id } });
    const incomingLocalIds = new Set(data.items.map((i) => i.localItemId));
    const toDelete = existingItems.filter((ei) => !incomingLocalIds.has(ei.localItemId));
    for (const item of toDelete) {
      await tx.quoteItem.delete({ where: { id: item.id } });
    }
    for (const [index, item] of data.items.entries()) {
      await tx.quoteItem.upsert({
        where: { localItemId: item.localItemId },
        create: {
          localItemId: item.localItemId,
          quoteId: quote.id,
          title: item.title,
          description: item.description,
          price: item.price,
          sortOrder: index,
        },
        update: { title: item.title, description: item.description, price: item.price, sortOrder: index },
      });
    }

    return quote.id;
  });

  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  return NextResponse.json({ quote }, { status: existing ? 200 : 201 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quotes = await prisma.quote.findMany({
    include: { client: true, items: true },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({ quotes });
}

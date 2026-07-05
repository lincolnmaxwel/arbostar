import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { calculateTotals } from '@/lib/quoteMath';
import { sendQuoteApprovalEmail } from '@/lib/email';

class ItemOwnershipConflictError extends Error {
  constructor(localItemId: string) {
    super(`localItemId ${localItemId} belongs to a different quote`);
    this.name = 'ItemOwnershipConflictError';
  }
}

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
  send: z.boolean().optional().default(false),
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

  const client = await prisma.client.upsert({
    where: { email: data.clientEmail },
    update: {},
    create: { name: data.clientName, email: data.clientEmail, phone: data.clientPhone, address: data.clientAddress },
  });

  const userId = session.user.id;

  let quoteId: string;
  try {
    quoteId = await prisma.$transaction(async (tx) => {
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
          status: data.send ? 'sent' : 'draft',
          sentAt: data.send ? new Date() : null,
        },
        update: {
          subtotal: totals.subtotal,
          taxRate: data.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          // Only a still-unsent quote transitions on "send"; re-saving an
          // already sent/approved/declined quote never reverts its status —
          // "Save and Send" on one of those just resends the email below.
          ...(data.send && existing?.status === 'draft' ? { status: 'sent' as const, sentAt: new Date() } : {}),
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

      // localItemId is globally unique across all quotes, but existingItems above
      // is scoped to this quote only, so it can't reveal a localItemId that
      // belongs to a *different* quote (e.g. this quote is brand new). Look up
      // ownership for every incoming localItemId across the whole table so we
      // never silently overwrite another quote's item via the upsert below.
      const ownersByLocalId = await tx.quoteItem.findMany({
        where: { localItemId: { in: data.items.map((i) => i.localItemId) } },
        select: { localItemId: true, quoteId: true },
      });
      const ownerByLocalId = new Map(ownersByLocalId.map((o) => [o.localItemId, o.quoteId]));

      for (const [index, item] of data.items.entries()) {
        const ownerQuoteId = ownerByLocalId.get(item.localItemId);
        if (ownerQuoteId !== undefined && ownerQuoteId !== quote.id) {
          throw new ItemOwnershipConflictError(item.localItemId);
        }
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
  } catch (err) {
    if (err instanceof ItemOwnershipConflictError) {
      return NextResponse.json({ error: 'item ownership conflict' }, { status: 409 });
    }
    throw err;
  }

  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  if (data.send) {
    const portalUrl = `${process.env.NEXTAUTH_URL}/portal/${quote.publicToken}`;
    await sendQuoteApprovalEmail({
      to: client.email,
      clientName: client.name,
      portalUrl,
      total: Number(quote.total),
    });
  }

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

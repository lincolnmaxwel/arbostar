import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
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
  serviceAddress: z.string().optional(),
  taxRate: z.number().min(0).max(1),
  items: z.array(quoteItemSchema).min(1),
  clientUpdatedAt: z.number().optional(),
  send: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }
  const ownerUserId = scope.ownerUserId;

  const body = await req.json();
  const parsed = upsertQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const totals = calculateTotals(data.items, data.taxRate);

  // The draft lookup is scoped by owner: a draftId that belongs to another
  // user is treated as unknown (404), never updated or exposed.
  const unscoped = await prisma.quote.findUnique({ where: { draftId: data.draftId } });
  const existing = unscoped && unscoped.createdById === ownerUserId ? unscoped : null;
  if (unscoped && !existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (existing && data.clientUpdatedAt !== undefined && existing.updatedAt.getTime() > data.clientUpdatedAt) {
    return NextResponse.json({ error: 'conflict', serverUpdatedAt: existing.updatedAt }, { status: 409 });
  }

  // Per-user client identity: the same email may exist once per owner. The
  // server derives the owner from the authenticated scope — never trust a
  // client-supplied owner.
  const client = await prisma.client.upsert({
    where: { userId_email: { userId: ownerUserId, email: data.clientEmail } },
    update: { name: data.clientName, phone: data.clientPhone, address: data.clientAddress },
    create: { name: data.clientName, email: data.clientEmail, phone: data.clientPhone, address: data.clientAddress, userId: ownerUserId },
  });

  let quoteId: string;
  try {
    quoteId = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.upsert({
        where: { draftId: data.draftId },
        create: {
          draftId: data.draftId,
          clientId: client.id,
          createdById: ownerUserId,
          subtotal: totals.subtotal,
          taxRate: data.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          serviceAddress: data.serviceAddress,
          status: data.send ? 'sent' : 'draft',
          sentAt: data.send ? new Date() : null,
        },
        update: {
          // Without this, editing the client's email into one that doesn't
          // match an existing Client row creates/finds a *different* Client
          // above (client.upsert is keyed by owner+email) but left this quote
          // pointed at its old clientId — the edit appeared to save, but the
          // next pull (GET /api/quotes, which includes the still-old
          // `client` relation) silently reverted it back.
          clientId: client.id,
          subtotal: totals.subtotal,
          taxRate: data.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          serviceAddress: data.serviceAddress,
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

  if (scope.isViewAs) {
    await auditScopedMutation(scope, 'Quote', quoteId, 'upsert');
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
      items: quote.items
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({ title: item.title, description: item.description, price: Number(item.price) })),
      subtotal: Number(quote.subtotal),
      taxRate: Number(quote.taxRate),
      taxAmount: Number(quote.taxAmount),
      total: Number(quote.total),
      serviceAddress: quote.serviceAddress ?? undefined,
    });
  }

  return NextResponse.json({ quote }, { status: existing ? 200 : 201 });
}

export async function GET() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const quotes = await prisma.quote.findMany({
    where: { createdById: scope.ownerUserId },
    include: { client: true, items: true },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({ quotes });
}
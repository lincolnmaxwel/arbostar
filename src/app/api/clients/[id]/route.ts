import { NextRequest, NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';
import { deleteClientCascade } from '@/lib/cascadeDelete';

const patchSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

// Client (userId, email) is unique — the same constraint client-creation
// relies on (see the upsert in POST /api/quotes) — so editing into one that
// collides with another of the SAME owner's clients fails with a clear 409
// instead of a raw Postgres unique-violation 500.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  if (!((await isFeatureEnabled(scope.ownerUserId, 'clients_crm')) || (await isFeatureEnabled(scope.ownerUserId, 'timesheet')))) {
    return featureDisabledResponse();
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.client.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    const client = await prisma.client.update({ where: { id: params.id }, data: parsed.data });
    await auditScopedMutation(scope, 'Client', client.id, 'update');
    return NextResponse.json({ client });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'email-taken', message: 'Another client already uses that email.' }, { status: 409 });
    }
    throw err;
  }
}

// Quote.client now cascades (see schema.prisma), so deleting a Client
// deletes all their quotes too (and, transitively, QuoteItems/QuotePhotos/
// ScheduleRounds via those relations' own Cascade rules). Invoice.quote does
// NOT cascade, on purpose — if any of the client's quotes still has an
// invoice, the delete fails with a clear 409 instead of a raw foreign-key
// 500, so staff know to delete the invoice(s) first (DELETE
// /api/invoices/[id]) before the client. A timesheet entry is permanently
// linked to its invoice; entries must be deleted first too.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  if (!((await isFeatureEnabled(scope.ownerUserId, 'clients_crm')) || (await isFeatureEnabled(scope.ownerUserId, 'timesheet')))) {
    return featureDisabledResponse();
  }

  const client = await prisma.client.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
  });
  if (!client) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Cascade everything attached to the client (timesheet entries, invoices
  // with their line items, quotes with items/photos/rounds) in one
  // transaction, then clean up the quote upload directories the database
  // doesn't know about.
  const { quoteIds } = await deleteClientCascade(client.id);

  await auditScopedMutation(scope, 'Client', client.id, 'delete');

  for (const quoteId of quoteIds) {
    const dir = path.join(process.cwd(), 'uploads', 'quotes', quoteId);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
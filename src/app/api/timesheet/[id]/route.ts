import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';
import { deleteInvoiceCascade } from '@/lib/cascadeDelete';
import {
  computeTimesheetTotals,
  productLineAmount,
  validateEntryTimes,
  validateProducts,
  TimesheetProductInput,
} from '@/lib/timesheetMath';

const productSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
});

const patchSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  description: z.string().trim().min(1, 'Description is required.').optional(),
  products: z.array(productSchema).optional(),
});

// PATCH and DELETE only allow open entries — an invoiced entry is frozen.
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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'timesheet'))) {
    return featureDisabledResponse();
  }

  const entry = await prisma.timesheetEntry.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
    include: { products: true },
  });
  if (!entry) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
  if (entry.status !== 'open') {
    return NextResponse.json({ error: 'Invoiced entries cannot be edited.' }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const startedAt = data.startedAt ? new Date(data.startedAt) : entry.startedAt;
  const endedAt = data.endedAt ? new Date(data.endedAt) : entry.endedAt;
  const timeError = validateEntryTimes(startedAt, endedAt);
  if (timeError) return NextResponse.json({ error: timeError }, { status: 400 });

  const workDate = data.workDate ? new Date(data.workDate + 'T12:00:00.000Z') : entry.workDate;

  // The entry keeps its original hourly-rate snapshot (editing times does not
  // rewrite the rate); totals recompute from it.
  const totals = computeTimesheetTotals(
    { hourlyRate: entry.hourlyRate, startedAt, endedAt, products: data.products ?? [] },
    0,
  );

  await prisma.$transaction(async (tx) => {
    await tx.timesheetEntry.update({
      where: { id: entry.id },
      data: {
        workDate,
        startedAt,
        endedAt,
        durationMinutes: totals.durationMinutes,
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
    });

    if (data.products !== undefined) {
      const incomingIds = new Set(data.products.filter((p) => p.id).map((p) => p.id!));
      await tx.timesheetProduct.deleteMany({
        where: { timesheetEntryId: entry.id, id: { notIn: [...incomingIds] } },
      });
      for (const p of data.products) {
        if (p.id) {
          await tx.timesheetProduct.update({
            where: { id: p.id },
            data: {
              name: p.name,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              lineTotal: productLineAmount(p.quantity, p.unitPrice),
            },
          });
        } else {
          await tx.timesheetProduct.create({
            data: {
              timesheetEntryId: entry.id,
              name: p.name,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              lineTotal: productLineAmount(p.quantity, p.unitPrice),
            },
          });
        }
      }
    }
  });

  await auditScopedMutation(scope, 'TimesheetEntry', entry.id, 'update');

  const updated = await prisma.timesheetEntry.findUniqueOrThrow({
    where: { id: entry.id },
    include: { client: { select: { id: true, name: true } }, products: { orderBy: { id: 'asc' } } },
  });
  return NextResponse.json({ entry: updated });
}

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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'timesheet'))) {
    return featureDisabledResponse();
  }

  const entry = await prisma.timesheetEntry.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
    include: { invoice: { select: { id: true, number: true } } },
  });
  if (!entry) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });

  // Open entry (no invoice): plain delete, products cascade.
  if (entry.status === 'open' && !entry.invoiceId) {
    await prisma.timesheetEntry.delete({ where: { id: entry.id } });
    await auditScopedMutation(scope, 'TimesheetEntry', entry.id, 'delete');
    return NextResponse.json({ ok: true });
  }

  // Invoiced entry: deleting it would leave its invoice orphaned and the
  // Restrict on TimesheetEntry.invoice blocks the entry delete — so delete
  // the whole invoice (and every sibling entry on it) instead, inside one
  // transaction. An invoiced entry without an invoice (inconsistent legacy
  // state) stays protected behind a 409.
  if (!entry.invoiceId) {
    return NextResponse.json({ error: 'Invoiced entries cannot be deleted.' }, { status: 409 });
  }

  const invoiceNumber = entry.invoice?.number;
  let entriesDeleted = 0;
  await prisma.$transaction(async (tx) => {
    entriesDeleted = await deleteInvoiceCascade(tx, entry.invoiceId!);
  });

  await auditScopedMutation(scope, 'TimesheetEntry', entry.id, 'delete');
  if (entry.invoiceId) {
    await auditScopedMutation(scope, 'Invoice', entry.invoiceId, 'delete');
  }

  return NextResponse.json({
    ok: true,
    invoiceDeleted: true,
    invoiceNumber: invoiceNumber ?? null,
    entriesDeleted,
  });
}
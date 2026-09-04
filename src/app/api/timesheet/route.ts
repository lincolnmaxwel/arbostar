import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';
import {
  computeTimesheetTotals,
  productLineAmount,
  validateEntryTimes,
  validateProducts,
  TimesheetProductInput,
} from '@/lib/timesheetMath';

const productSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
});

const entrySchema = z.object({
  clientId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.string(),
  endedAt: z.string(),
  products: z.array(productSchema).optional().default([]),
});

export async function GET(req: NextRequest) {
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

  const clientId = req.nextUrl.searchParams.get('clientId');
  const dateFrom = req.nextUrl.searchParams.get('dateFrom');
  const dateTo = req.nextUrl.searchParams.get('dateTo');

  const entries = await prisma.timesheetEntry.findMany({
    where: {
      userId: scope.ownerUserId,
      ...(clientId ? { clientId } : {}),
      ...(dateFrom ? { workDate: { gte: new Date(dateFrom + 'T00:00:00.000Z') } } : {}),
      // Inclusive end-of-day: entries are stored at noon, so a bare midnight
      // cutoff would drop same-day entries.
      ...(dateTo ? { workDate: { lte: new Date(dateTo + 'T23:59:59.999Z') } } : {}),
    },
    include: { client: { select: { id: true, name: true } }, products: { orderBy: { id: 'asc' } } },
    orderBy: { workDate: 'desc' },
  });

  return NextResponse.json({ entries });
}

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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'timesheet'))) {
    return featureDisabledResponse();
  }

  const body = await req.json().catch(() => null);
  const parsed = entrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const client = await prisma.client.findUnique({
    where: { id: data.clientId, userId: scope.ownerUserId },
  });
  if (!client) {
    return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
  }

  const startedAt = new Date(data.startedAt);
  const endedAt = new Date(data.endedAt);
  const timeError = validateEntryTimes(startedAt, endedAt);
  if (timeError) return NextResponse.json({ error: timeError }, { status: 400 });

  const productError = validateProducts(data.products as TimesheetProductInput[]);
  if (productError) return NextResponse.json({ error: productError }, { status: 400 });

  // Snapshot the user's current hourly rate — later changes to the default
  // never rewrite existing entries.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: scope.ownerUserId } });

  const totals = computeTimesheetTotals(
    { hourlyRate: user.hourlyRate, startedAt, endedAt, products: data.products as TimesheetProductInput[] },
    0,
  );

  const entry = await prisma.timesheetEntry.create({
    data: {
      userId: scope.ownerUserId,
      clientId: data.clientId,
      workDate: new Date(data.workDate + 'T12:00:00.000Z'),
      startedAt,
      endedAt,
      durationMinutes: totals.durationMinutes,
      hourlyRate: user.hourlyRate,
      products: {
        create: (data.products as TimesheetProductInput[]).map((p) => ({
          name: p.name,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          lineTotal: productLineAmount(p.quantity, p.unitPrice),
        })),
      },
    },
    include: { client: { select: { id: true, name: true } }, products: true },
  });

  await auditScopedMutation(scope, 'TimesheetEntry', entry.id, 'create');

  return NextResponse.json({ entry }, { status: 201 });
}
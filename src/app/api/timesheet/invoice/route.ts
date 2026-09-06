import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';
import {
  computeTimesheetTotals,
  DEFAULT_TIMESHEET_TAX_RATE,
  validateTaxRate,
  formatDateRange,
  TimesheetProductInput,
} from '@/lib/timesheetMath';
import { getCompanyProfile } from '@/lib/companyProfile';
import { sendInvoiceEmail } from '@/lib/email';
import { buildInvoicePdf } from '@/lib/invoicePdf';

const invoiceSchema = z.object({
  clientId: z.string().min(1),
  entryIds: z.array(z.string().min(1)).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  taxRate: z.number().optional(),
  serviceAddress: z.string().optional(),
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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'timesheet'))) {
    return featureDisabledResponse();
  }

  const body = await req.json().catch(() => null);
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (!data.entryIds && !data.dateFrom) {
    return NextResponse.json(
      { error: 'Provide entryIds or a date range (dateFrom) to select entries.' },
      { status: 400 },
    );
  }

  const taxRate = data.taxRate ?? Number(DEFAULT_TIMESHEET_TAX_RATE);
  const taxRateError = validateTaxRate(taxRate);
  if (taxRateError) return NextResponse.json({ error: taxRateError }, { status: 400 });

  const client = await prisma.client.findUnique({
    where: { id: data.clientId, userId: scope.ownerUserId },
  });
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });

  const selected = await prisma.timesheetEntry.findMany({
    where: {
      userId: scope.ownerUserId,
      clientId: data.clientId,
      status: 'open',
      ...(data.entryIds ? { id: { in: data.entryIds } } : {}),
      ...(data.dateFrom ? { workDate: { gte: new Date(data.dateFrom + 'T00:00:00.000Z') } } : {}),
      // Inclusive end-of-day: entries are stored at noon, so a bare midnight
      // cutoff would drop same-day entries.
      ...(data.dateTo ? { workDate: { lte: new Date(data.dateTo + 'T23:59:59.999Z') } } : {}),
    },
    include: { products: true },
    orderBy: { workDate: 'asc' },
  });

  if (selected.length === 0) {
    // With explicit entryIds, a missing selection means they were already
    // invoiced (or not ours) — a conflict, not an unknown-client 404.
    if (data.entryIds) {
      return NextResponse.json(
        { error: 'conflict', message: 'One or more entries were already invoiced. Refresh and try again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'No open entries match the selection.' }, { status: 404 });
  }

  if (data.entryIds) {
    const requested = new Set(data.entryIds);
    const found = new Set(selected.map((e) => e.id));
    const missing = [...requested].filter((id) => !found.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Some entries are not open, not owned by you, or belong to another client.' },
        { status: 409 },
      );
    }
  }

  // Aggregated line snapshot: one immutable InvoiceLineItem per labor group
  // (serviceName + hourlyRate, which is usually a single group for the whole
  // period) and one per distinct product (name + unitPrice). Per-entry totals
  // still feed the subtotal so the sum is identical to before — just in fewer
  // lines. Labor notes concatenate every entry's date + description.
  let lineOrder = 0;
  const entriesByWork = [...selected].sort((a, b) => a.workDate.getTime() - b.workDate.getTime());
  const laborGroups = new Map<
    string,
    { serviceName: string; hourlyRate: Prisma.Decimal; minutes: number; amount: Prisma.Decimal; notes: string[] }
  >();
  const productGroups = new Map<
    string,
    { name: string; unitPrice: Prisma.Decimal; quantity: Prisma.Decimal; amount: Prisma.Decimal }
  >();

  let subtotal = new Prisma.Decimal(0);
  for (const entry of entriesByWork) {
    const totals = computeTimesheetTotals(
      {
        hourlyRate: entry.hourlyRate,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        products: entry.products.map(
          (p) => ({ name: p.name, quantity: Number(p.quantity), unitPrice: Number(p.unitPrice) }) as TimesheetProductInput,
        ),
      },
      taxRate,
    );
    subtotal = subtotal.plus(totals.subtotal);

    const laborKey = `${entry.serviceName}|${entry.hourlyRate}`;
    const laborGroup = laborGroups.get(laborKey);
    if (laborGroup) {
      // Accumulate whole minutes (integer, float-error-free); hours are
      // derived once, rounded, when the line is built below.
      laborGroup.minutes += totals.durationMinutes;
      laborGroup.amount = laborGroup.amount.plus(totals.laborAmount);
      laborGroup.notes.push(`${entry.workDate.toISOString().slice(0, 10)}: ${entry.description}`);
    } else {
      laborGroups.set(laborKey, {
        serviceName: entry.serviceName,
        hourlyRate: entry.hourlyRate,
        minutes: totals.durationMinutes,
        amount: totals.laborAmount,
        notes: [`${entry.workDate.toISOString().slice(0, 10)}: ${entry.description}`],
      });
    }

    for (const p of entry.products) {
      const productKey = `${p.name}|${p.unitPrice}`;
      const productGroup = productGroups.get(productKey);
      if (productGroup) {
        productGroup.quantity = productGroup.quantity.plus(p.quantity);
        productGroup.amount = productGroup.amount.plus(p.lineTotal);
      } else {
        productGroups.set(productKey, {
          name: p.name,
          unitPrice: p.unitPrice,
          quantity: p.quantity,
          amount: p.lineTotal,
        });
      }
    }
  }

  const lines: {
    description: string;
    notes: string | null;
    quantity: number | Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    amount: Prisma.Decimal;
    sortOrder: number;
  }[] = [];
  for (const group of laborGroups.values()) {
    lines.push({
      description: group.serviceName,
      notes: group.notes.join('\n'),
      // Round once, at line build time — same 2dp precision the entry list
      // Hours column uses.
      quantity: new Prisma.Decimal(group.minutes).dividedBy(60).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      unitPrice: group.hourlyRate,
      amount: group.amount,
      sortOrder: lineOrder++,
    });
  }
  for (const group of productGroups.values()) {
    lines.push({
      description: group.name,
      notes: null,
      quantity: group.quantity,
      unitPrice: group.unitPrice,
      amount: group.amount,
      sortOrder: lineOrder++,
    });
  }

  subtotal = subtotal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const rate = new Prisma.Decimal(taxRate);
  const taxAmount = subtotal.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const total = subtotal.plus(taxAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  // Serializable transaction: recheck the exact open set, create the invoice
  // and its immutable lines, then mark every selected entry invoiced. If a
  // concurrent generation already invoiced some of them, the count update
  // differs and the whole transaction aborts with 409 — never partial.
  let invoice;
  try {
    invoice = await prisma.$transaction(
      async (tx) => {
        const stillOpen = await tx.timesheetEntry.count({
          where: { id: { in: selected.map((e) => e.id) }, status: 'open' },
        });
        if (stillOpen !== selected.length) {
          throw new TimesheetSelectionConflictError();
        }

        const created = await tx.invoice.create({
          data: {
            source: 'timesheet',
            userId: scope.ownerUserId,
            clientId: data.clientId,
            serviceAddress: data.serviceAddress ?? null,
            subtotal,
            taxRate: rate,
            taxAmount,
            total,
            sentAt: new Date(),
            lineItems: {
              create: lines,
            },
          },
        });

        const update = await tx.timesheetEntry.updateMany({
          where: { id: { in: selected.map((e) => e.id) }, status: 'open' },
          data: { status: 'invoiced', invoiceId: created.id },
        });
        if (update.count !== selected.length) {
          throw new TimesheetSelectionConflictError();
        }

        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (err instanceof TimesheetSelectionConflictError || isDeadlockOrSerializationError(err)) {
      return NextResponse.json(
        { error: 'conflict', message: 'One or more entries were already invoiced. Refresh and try again.' },
        { status: 409 },
      );
    }
    throw err;
  }

  await auditScopedMutation(scope, 'Invoice', invoice.id, 'create');

  // Email/PDF failures must not roll back the committed invoice.
  try {
    const company = await getCompanyProfile(scope.ownerUserId);
    // selected is ordered by workDate asc, so the first/last entries bound the
    // invoice period. Derived on the fly — never persisted.
    const period = formatDateRange(selected[0].workDate, selected[selected.length - 1].workDate);
    const items = lines.map((line) => ({
        title: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        price: Number(line.amount),
      }));

    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await buildInvoicePdf({
        invoiceNumber: invoice.number,
        date: invoice.createdAt,
        period,
        client: { name: client.name, email: client.email, phone: client.phone, address: client.address },
        serviceAddress: data.serviceAddress ?? null,
        company: { name: company.name, phone: company.phone, email: company.email, address: company.address, logoPath: company.logoPath },
        items,
        subtotal: Number(subtotal),
        taxRate: Number(rate),
        taxAmount: Number(taxAmount),
        total: Number(total),
      });
    } catch (err) {
      console.error('[timesheet/invoice] buildInvoicePdf failed', err);
    }

    await sendInvoiceEmail({
      to: client.email,
      clientName: client.name,
      invoiceNumber: invoice.number,
      period,
      companyName: company.name ?? undefined,
      items,
      subtotal: Number(subtotal),
      taxRate: Number(rate),
      taxAmount: Number(taxAmount),
      total: Number(total),
      pdfBuffer,
    });
  } catch (err) {
    console.error('[timesheet/invoice] sendInvoiceEmail failed', err);
  }

  return NextResponse.json(
    {
      invoice,
      entryIds: selected.map((e) => e.id),
    },
    { status: 201 },
  );
}

class TimesheetSelectionConflictError extends Error {
  constructor() {
    super('timesheet selection conflict');
  }
}

function isDeadlockOrSerializationError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: transaction failed due to a write conflict (serializable).
    return err.code === 'P2034';
  }
  return false;
}
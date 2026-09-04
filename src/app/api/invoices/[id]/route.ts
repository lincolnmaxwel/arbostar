import { NextRequest, NextResponse } from 'next/server';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';
import { getCompanyProfile, companyLogoUrl } from '@/lib/companyProfile';
import { sendPaymentReceivedEmail } from '@/lib/email';

const INVOICE_INCLUDE = {
  client: true,
  quote: { include: { client: true, items: { orderBy: { sortOrder: 'asc' } } } },
  lineItems: { orderBy: { sortOrder: 'asc' } },
} as const;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  if (!(await isFeatureEnabled(scope.ownerUserId, 'invoices'))) {
    return featureDisabledResponse();
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ invoice });
}

// Marks payment received — a one-way transition (Pending payment -> Paid).
// Once paid, staff can no longer flip it back: the client has already been
// sent a "payment received" receipt, so undoing it would make that email a
// lie. Confirmation lives in the UI (MarkPaidButton's window.confirm) since
// this can't be undone.
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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'invoices'))) {
    return featureDisabledResponse();
  }

  const body = await req.json().catch(() => null);
  if (body?.paymentStatus !== 'paid') {
    return NextResponse.json({ error: 'invalid paymentStatus' }, { status: 400 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (invoice.paymentStatus === 'paid') {
    return NextResponse.json({ error: 'already-paid' }, { status: 409 });
  }

  const updated = await prisma.invoice.update({
    where: { id: params.id },
    data: { paymentStatus: 'paid', paidAt: new Date() },
  });

  await auditScopedMutation(scope, 'Invoice', updated.id, 'mark-paid');

  try {
    const company = await getCompanyProfile(invoice.userId);
    const logoUrl = companyLogoUrl(company.logoPath);
    // Source-neutral line data: quote invoices use the quote's items,
    // timesheet invoices use the frozen line-item rows.
    const items =
      invoice.source === 'timesheet'
        ? invoice.lineItems.map((l) => ({ title: l.description, price: Number(l.amount) }))
        : invoice.quote?.items.map((item) => ({ title: item.title, price: Number(item.price) })) ?? [];
    await sendPaymentReceivedEmail({
      to: invoice.client.email,
      clientName: invoice.client.name,
      invoiceNumber: invoice.number,
      companyName: company.name ?? undefined,
      logoUrl: logoUrl ? `${process.env.NEXTAUTH_URL}${logoUrl}` : undefined,
      items,
      total: Number(invoice.total),
    });
  } catch (err) {
    // Marking the invoice paid already succeeded — a notification failure
    // shouldn't undo that or surface as a 5xx to staff, same pattern as
    // sendInvoiceEmail's own try/catch in complete/route.ts.
    console.error('[invoices/[id] PATCH] sendPaymentReceivedEmail failed', err);
  }

  return NextResponse.json({ invoice: updated });
}

// Invoice.quote has no onDelete: Cascade (see schema.prisma) — deliberately,
// since an invoice is a record the client already received by email, not
// something that should vanish as a side effect of deleting its quote or
// client. Deleting it here is the explicit step that unblocks deleting the
// quote/client afterward. A timesheet invoice is permanent: its entries are
// frozen into the invoice, so it can never be deleted.
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

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
  });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (invoice.source === 'timesheet') {
    return NextResponse.json(
      { error: 'timesheet-invoice-locked', message: 'Timesheet invoices cannot be deleted.' },
      { status: 409 },
    );
  }

  await prisma.invoice.delete({ where: { id: params.id } });

  await auditScopedMutation(scope, 'Invoice', invoice.id, 'delete');

  return NextResponse.json({ ok: true });
}
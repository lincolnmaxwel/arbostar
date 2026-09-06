import { NextRequest, NextResponse } from 'next/server';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';
import { getCompanyProfile } from '@/lib/companyProfile';
import { buildInvoicePdf } from '@/lib/invoicePdf';
import { formatDateRange } from '@/lib/timesheetMath';

// Regenerates the exact PDF sendInvoiceEmail attached when the invoice was
// created — same buildInvoicePdf, same frozen quote/invoice totals — so a
// staff download always matches what the client received by email. Renders
// both sources: quote items (with the quote number) or frozen timesheet
// line items.
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
    include: {
      client: true,
      quote: { include: { client: true, items: { orderBy: { sortOrder: 'asc' } } } },
      lineItems: { orderBy: { sortOrder: 'asc' } },
      timesheetEntries: { select: { workDate: true }, orderBy: { workDate: 'asc' } },
    },
  });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const company = await getCompanyProfile(invoice.userId);

  // The period is derived from the linked entries on every download — never
  // persisted on the invoice itself.
  const period =
    invoice.source === 'timesheet' && invoice.timesheetEntries.length > 0
      ? formatDateRange(
          invoice.timesheetEntries[0].workDate,
          invoice.timesheetEntries[invoice.timesheetEntries.length - 1].workDate,
        )
      : undefined;

  const items =
    invoice.source === 'timesheet'
      ? invoice.lineItems.map((l) => ({
          title: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          price: Number(l.amount),
        }))
      : (invoice.quote?.items.map((item) => ({
          title: item.title,
          description: item.description,
          price: Number(item.price),
        })) ?? []);

  const pdfBuffer = await buildInvoicePdf({
    invoiceNumber: invoice.number,
    quoteNumber: invoice.quote?.number,
    date: invoice.createdAt,
    period,
    client: {
      name: invoice.client.name,
      email: invoice.client.email,
      phone: invoice.client.phone,
      address: invoice.client.address,
    },
    serviceAddress: invoice.serviceAddress,
    company: { name: company.name, phone: company.phone, email: company.email, address: company.address, logoPath: company.logoPath },
    items,
    subtotal: Number(invoice.subtotal),
    taxRate: Number(invoice.taxRate),
    taxAmount: Number(invoice.taxAmount),
    total: Number(invoice.total),
  });

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${invoice.number}.pdf"`,
      'Content-Length': String(pdfBuffer.length),
    },
  });
}
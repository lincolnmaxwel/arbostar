import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCompanyProfile } from '@/lib/companyProfile';
import { sendInvoiceEmail } from '@/lib/email';
import { buildInvoicePdf } from '@/lib/invoicePdf';

// Marks a scheduled job Completed and generates its (one and only) Invoice —
// a snapshot of the quote's totals at that moment, not a live recompute, so
// later edits to the quote can't silently change an invoice the client
// already received by email.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { client: true, items: { orderBy: { sortOrder: 'asc' } }, invoice: true },
  });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (quote.status !== 'scheduled') {
    return NextResponse.json({ error: quote.status === 'completed' ? 'already-completed' : 'not-scheduled' }, { status: 409 });
  }
  if (quote.invoice) {
    // Shouldn't happen if status is guarded correctly above, but the unique
    // constraint on Invoice.quoteId would 500 on a duplicate create anyway —
    // fail clearly instead.
    return NextResponse.json({ error: 'already-completed' }, { status: 409 });
  }

  const [, invoice] = await prisma.$transaction([
    prisma.quote.update({ where: { id: quote.id }, data: { status: 'completed' } }),
    prisma.invoice.create({
      data: {
        quoteId: quote.id,
        subtotal: quote.subtotal,
        taxRate: quote.taxRate,
        taxAmount: quote.taxAmount,
        total: quote.total,
        sentAt: new Date(),
      },
    }),
  ]);

  try {
    const company = await getCompanyProfile();
    const items = quote.items.map((item) => ({ title: item.title, description: item.description, price: Number(item.price) }));

    // A PDF failure (a corrupt/missing logo file, say) shouldn't take the
    // email down with it — fall back to sending without the attachment
    // rather than losing the invoice notification entirely.
    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await buildInvoicePdf({
        invoiceNumber: invoice.number,
        quoteNumber: quote.number,
        date: invoice.createdAt,
        client: { name: quote.client.name, email: quote.client.email, phone: quote.client.phone, address: quote.client.address },
        serviceAddress: quote.serviceAddress,
        company: { name: company.name, phone: company.phone, email: company.email, address: company.address, logoPath: company.logoPath },
        items,
        subtotal: Number(quote.subtotal),
        taxRate: Number(quote.taxRate),
        taxAmount: Number(quote.taxAmount),
        total: Number(quote.total),
      });
    } catch (err) {
      console.error('[quotes/complete] buildInvoicePdf failed', err);
    }

    await sendInvoiceEmail({
      to: quote.client.email,
      clientName: quote.client.name,
      invoiceNumber: invoice.number,
      companyName: company.name ?? undefined,
      items,
      subtotal: Number(quote.subtotal),
      taxRate: Number(quote.taxRate),
      taxAmount: Number(quote.taxAmount),
      total: Number(quote.total),
      pdfBuffer,
    });
  } catch (err) {
    // The job is already marked completed and the invoice already exists —
    // an email failure shouldn't undo that or surface as a 5xx to staff.
    console.error('[quotes/complete] sendInvoiceEmail failed', err);
  }

  return NextResponse.json({ quote: { ...quote, status: 'completed' }, invoice }, { status: 201 });
}

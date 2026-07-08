import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCompanyProfile } from '@/lib/companyProfile';
import { buildInvoicePdf } from '@/lib/invoicePdf';

// Regenerates the exact PDF sendInvoiceEmail attached when the invoice was
// created — same buildInvoicePdf, same frozen quote/invoice totals — so a
// staff download always matches what the client received by email.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { quote: { include: { client: true, items: { orderBy: { sortOrder: 'asc' } } } } },
  });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const company = await getCompanyProfile();
  const items = invoice.quote.items.map((item) => ({
    title: item.title,
    description: item.description,
    price: Number(item.price),
  }));

  const pdfBuffer = await buildInvoicePdf({
    invoiceNumber: invoice.number,
    quoteNumber: invoice.quote.number,
    date: invoice.createdAt,
    client: {
      name: invoice.quote.client.name,
      email: invoice.quote.client.email,
      phone: invoice.quote.client.phone,
      address: invoice.quote.client.address,
    },
    serviceAddress: invoice.quote.serviceAddress,
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

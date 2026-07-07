import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET as listInvoices } from '@/app/api/invoices/route';
import { GET as getInvoice } from '@/app/api/invoices/[id]/route';
import { prisma } from '@/lib/db';

describe('/api/invoices', () => {
  let userId: string;
  let quoteId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Invoices Test', email: `invoicesapi-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });

    const client = await prisma.client.create({ data: { name: 'Invoice Client', email: `invclient-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'completed',
        subtotal: 500,
        taxRate: 0.05,
        taxAmount: 25,
        total: 525,
        items: { create: [{ localItemId: randomUUID(), title: 'Tree removal', price: 500, sortOrder: 0 }] },
      },
    });
    quoteId = quote.id;
    const invoice = await prisma.invoice.create({
      data: { quoteId: quote.id, subtotal: 500, taxRate: 0.05, taxAmount: 25, total: 525, sentAt: new Date() },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { quoteId } });
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('GET list returns invoices with client and quote info', async () => {
    const res = await listInvoices();
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.invoices.find((inv: { id: string }) => inv.id === invoiceId);
    expect(found).toBeDefined();
    expect(found.quote.client.name).toBe('Invoice Client');
    expect(Number(found.total)).toBe(525);
  });

  it('GET list returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await listInvoices();
    expect(res.status).toBe(401);
  });

  it('GET detail returns the invoice with quote items', async () => {
    const res = await getInvoice(new Request(`http://localhost/api/invoices/${invoiceId}`) as any, { params: { id: invoiceId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice.quote.items).toHaveLength(1);
    expect(body.invoice.quote.items[0].title).toBe('Tree removal');
  });

  it('GET detail returns 404 for an unknown invoice', async () => {
    const res = await getInvoice(new Request('http://localhost/api/invoices/does-not-exist') as any, { params: { id: 'does-not-exist' } });
    expect(res.status).toBe(404);
  });
});

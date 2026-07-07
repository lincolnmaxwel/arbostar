import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) }));

import { getServerSession } from 'next-auth';
import { sendInvoiceEmail } from '@/lib/email';
import { POST } from '@/app/api/quotes/[id]/complete/route';
import { prisma } from '@/lib/db';

describe('POST /api/quotes/[id]/complete', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Complete Test', email: `complete-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { quote: { createdById: userId } } });
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function createScheduledQuote() {
    const client = await prisma.client.create({ data: { name: 'Nelson Costa', email: `client-${randomUUID()}@example.com` } });
    return prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'scheduled',
        subtotal: 500,
        taxRate: 0.05,
        taxAmount: 25,
        total: 525,
        items: { create: [{ localItemId: randomUUID(), title: 'Tree removal', price: 500, sortOrder: 0 }] },
      },
    });
  }

  it('marks the quote completed, creates an invoice with the frozen totals, and emails the client', async () => {
    const quote = await createScheduledQuote();

    const res = await POST(new Request(`http://localhost/api/quotes/${quote.id}/complete`, { method: 'POST' }) as any, {
      params: { id: quote.id },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.quote.status).toBe('completed');
    expect(Number(body.invoice.total)).toBe(525);

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.status).toBe('completed');

    const invoice = await prisma.invoice.findUnique({ where: { quoteId: quote.id } });
    expect(invoice).not.toBeNull();
    expect(Number(invoice!.subtotal)).toBe(500);

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(sendInvoiceEmail).toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: invoice!.number, total: 525 }));
  });

  it('rejects completing a quote that is not scheduled', async () => {
    const client = await prisma.client.create({ data: { name: 'Not Scheduled', email: `client-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'approved',
        items: { create: [{ localItemId: randomUUID(), title: 'Hedges', price: 100, sortOrder: 0 }] },
      },
    });

    const res = await POST(new Request(`http://localhost/api/quotes/${quote.id}/complete`, { method: 'POST' }) as any, {
      params: { id: quote.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('not-scheduled');
  });

  it('rejects completing an already-completed quote', async () => {
    const quote = await createScheduledQuote();
    await POST(new Request(`http://localhost/api/quotes/${quote.id}/complete`, { method: 'POST' }) as any, { params: { id: quote.id } });

    const res = await POST(new Request(`http://localhost/api/quotes/${quote.id}/complete`, { method: 'POST' }) as any, {
      params: { id: quote.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already-completed');
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await POST(new Request('http://localhost/api/quotes/anything/complete', { method: 'POST' }) as any, {
      params: { id: 'anything' },
    });
    expect(res.status).toBe(401);
  });
});

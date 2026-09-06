import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));

import { getServerSession } from 'next-auth';
import { DELETE } from '@/app/api/quotes/[id]/route';
import { prisma } from '@/lib/db';

describe('DELETE /api/quotes/[id]', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Delete Test',
        email: `delete-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'quotes', enabled: true } },
      },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.userFeatureFlag.deleteMany({ where: { userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('deletes a quote and cascades its items and photos', async () => {
    const client = await prisma.client.create({ data: { userId, name: 'Client', email: `client-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        items: { create: [{ localItemId: randomUUID(), title: 'Hedges', price: 100, sortOrder: 0 }] },
      },
      include: { items: true },
    });
    const itemId = quote.items[0].id;
    await prisma.quotePhoto.create({ data: { quoteItemId: itemId, filePath: '/uploads/quotes/does-not-matter.jpg', sortOrder: 0 } });

    const res = await DELETE(new Request(`http://localhost/api/quotes/${quote.id}`, { method: 'DELETE' }) as any, {
      params: { id: quote.id },
    });

    expect(res.status).toBe(200);
    expect(await prisma.quote.findUnique({ where: { id: quote.id } })).toBeNull();
    expect(await prisma.quoteItem.findUnique({ where: { id: itemId } })).toBeNull();
    expect(await prisma.quotePhoto.findMany({ where: { quoteItemId: itemId } })).toHaveLength(0);
  });

  it('returns 409 (not a raw 500) when the quote still has an invoice', async () => {
    const client = await prisma.client.create({ data: { userId, name: 'Invoiced Client', email: `client-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: client.id, createdById: userId, status: 'completed' },
    });
    const invoice = await prisma.invoice.create({
      data: { quoteId: quote.id, userId, clientId: client.id, subtotal: 100, taxRate: 0.05, taxAmount: 5, total: 105 },
    });

    const res = await DELETE(new Request(`http://localhost/api/quotes/${quote.id}`, { method: 'DELETE' }) as any, {
      params: { id: quote.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('has-invoice');

    // Cleanup: delete the invoice first (the whole point of the 409), then the quote and client.
    await prisma.invoice.delete({ where: { id: invoice.id } });
    await prisma.quote.delete({ where: { id: quote.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });

  it('returns 404 for a quote that does not exist', async () => {
    const res = await DELETE(new Request('http://localhost/api/quotes/does-not-exist', { method: 'DELETE' }) as any, {
      params: { id: 'does-not-exist' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await DELETE(new Request('http://localhost/api/quotes/anything', { method: 'DELETE' }) as any, {
      params: { id: 'anything' },
    });
    expect(res.status).toBe(401);
  });
});

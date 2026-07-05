import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { DELETE } from '@/app/api/quotes/[id]/route';
import { prisma } from '@/lib/db';

describe('DELETE /api/quotes/[id]', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Delete Test', email: `delete-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it('deletes a quote and cascades its items and photos', async () => {
    const client = await prisma.client.create({ data: { name: 'Client', email: `client-${randomUUID()}@example.com` } });
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

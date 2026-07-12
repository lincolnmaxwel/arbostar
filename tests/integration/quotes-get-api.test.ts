import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/quotes/[id]/route';
import { prisma } from '@/lib/db';

describe('GET /api/quotes/[id]', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Get Test', email: `get-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('returns the quote with its status and publicToken', async () => {
    const client = await prisma.client.create({ data: { name: 'Client', email: `client-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'sent',
        items: { create: [{ localItemId: randomUUID(), title: 'Hedges', price: 100, sortOrder: 0 }] },
      },
    });

    const res = await GET(new Request(`http://localhost/api/quotes/${quote.id}`) as any, { params: { id: quote.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote.status).toBe('sent');
    expect(body.quote.publicToken).toBe(quote.publicToken);
  });

  it('includes items (keyed by localItemId) with their photos, for cross-device photo fallback', async () => {
    const client = await prisma.client.create({ data: { name: 'Client', email: `client-${randomUUID()}@example.com` } });
    const localItemId = randomUUID();
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'sent',
        items: {
          create: [
            {
              localItemId,
              title: 'Hedges',
              price: 100,
              sortOrder: 0,
              photos: { create: [{ filePath: '/api/uploads/quotes/x/y.jpg', sortOrder: 0 }] },
            },
          ],
        },
      },
    });

    const res = await GET(new Request(`http://localhost/api/quotes/${quote.id}`) as any, { params: { id: quote.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote.items).toHaveLength(1);
    expect(body.quote.items[0].localItemId).toBe(localItemId);
    expect(body.quote.items[0].photos).toHaveLength(1);
    expect(body.quote.items[0].photos[0].filePath).toBe('/api/uploads/quotes/x/y.jpg');
  });

  it('returns 404 for a quote that does not exist', async () => {
    const res = await GET(new Request('http://localhost/api/quotes/does-not-exist') as any, { params: { id: 'does-not-exist' } });
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET(new Request('http://localhost/api/quotes/anything') as any, { params: { id: 'anything' } });
    expect(res.status).toBe(401);
  });
});

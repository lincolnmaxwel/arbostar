import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { POST, GET } from '@/app/api/quotes/route';
import { prisma } from '@/lib/db';

describe('/api/quotes', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Test Staff', email: `staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('creates a quote on first POST and updates (not duplicates) on retry with the same draftId', async () => {
    const draftId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    const payload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      taxRate: 0.05,
      items: [
        { localItemId: itemA, title: 'Hedges', price: 1250 },
        { localItemId: itemB, title: 'Hedges', price: 500 },
      ],
    };

    const res1 = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payload) }) as any);
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(Number(body1.quote.total)).toBe(1837.5);
    const firstItemIds = body1.quote.items.map((i: { id: string }) => i.id).sort();

    const res2 = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payload) }) as any);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    const secondItemIds = body2.quote.items.map((i: { id: string }) => i.id).sort();

    const count = await prisma.quote.count({ where: { draftId } });
    expect(count).toBe(1);
    expect(secondItemIds).toEqual(firstItemIds); // same QuoteItem rows reused, not recreated
  });

  it('drops an item that was removed from the payload and keeps the rest stable', async () => {
    const draftId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    const basePayload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      taxRate: 0.05,
      items: [
        { localItemId: itemA, title: 'Hedges', price: 1250 },
        { localItemId: itemB, title: 'Trim', price: 500 },
      ],
    };
    const res1 = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(basePayload) }) as any);
    const body1 = await res1.json();
    const keptItemId = body1.quote.items.find((i: { localItemId: string }) => i.localItemId === itemA).id;

    const res2 = await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, items: [{ localItemId: itemA, title: 'Hedges', price: 1250 }] }),
      }) as any,
    );
    const body2 = await res2.json();
    expect(body2.quote.items).toHaveLength(1);
    expect(body2.quote.items[0].id).toBe(keptItemId);
  });

  it('returns 409 when clientUpdatedAt is older than the server row', async () => {
    const draftId = randomUUID();
    const basePayload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      taxRate: 0.05,
      items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
    };
    await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(basePayload) }) as any);

    const staleRes = await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, clientUpdatedAt: 1 }),
      }) as any,
    );
    expect(staleRes.status).toBe(409);
  });

  it('lists quotes', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.quotes)).toBe(true);
  });
});

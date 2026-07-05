import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { POST } from '@/app/api/portal/[token]/respond/route';
import { prisma } from '@/lib/db';

describe('POST /api/portal/[token]/respond', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Portal Test', email: `portal-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function createSentQuote() {
    const client = await prisma.client.create({ data: { name: 'Client', email: `client-${randomUUID()}@example.com` } });
    return prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'sent',
        items: { create: [{ localItemId: randomUUID(), title: 'Hedges', price: 100, sortOrder: 0 }] },
      },
    });
  }

  it('approves a sent quote and records respondedAt (no auth required)', async () => {
    const quote = await createSentQuote();

    const res = await POST(
      new Request(`http://localhost/api/portal/${quote.publicToken}/respond`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      }) as any,
      { params: { token: quote.publicToken } },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.status).toBe('approved');
    expect(updated.respondedAt).not.toBeNull();
  });

  it('declines a sent quote', async () => {
    const quote = await createSentQuote();

    const res = await POST(
      new Request(`http://localhost/api/portal/${quote.publicToken}/respond`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'decline' }),
      }) as any,
      { params: { token: quote.publicToken } },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('declined');
  });

  it('is idempotent: responding again after already approved does not change respondedAt', async () => {
    const quote = await createSentQuote();
    await POST(
      new Request(`http://localhost/api/portal/${quote.publicToken}/respond`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }) as any,
      { params: { token: quote.publicToken } },
    );
    const firstRespondedAt = (await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).respondedAt;

    const res = await POST(
      new Request(`http://localhost/api/portal/${quote.publicToken}/respond`, { method: 'POST', body: JSON.stringify({ decision: 'decline' }) }) as any,
      { params: { token: quote.publicToken } },
    );
    expect((await res.json()).status).toBe('approved'); // unchanged, not flipped to declined

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.status).toBe('approved');
    expect(after.respondedAt?.getTime()).toBe(firstRespondedAt?.getTime());
  });

  it('returns 404 for an unknown token', async () => {
    const res = await POST(
      new Request('http://localhost/api/portal/does-not-exist/respond', { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }) as any,
      { params: { token: 'does-not-exist' } },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid decision value', async () => {
    const quote = await createSentQuote();
    const res = await POST(
      new Request(`http://localhost/api/portal/${quote.publicToken}/respond`, { method: 'POST', body: JSON.stringify({ decision: 'maybe' }) }) as any,
      { params: { token: quote.publicToken } },
    );
    expect(res.status).toBe(400);
  });
});

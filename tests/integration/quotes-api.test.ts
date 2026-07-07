import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendQuoteApprovalEmail: vi.fn().mockResolvedValue(undefined) }));

import { getServerSession } from 'next-auth';
import { sendQuoteApprovalEmail } from '@/lib/email';
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

  it('rejects a localItemId reused from a different quote without corrupting the original item', async () => {
    const draftIdA = randomUUID();
    const sharedItemId = randomUUID();
    const payloadA = {
      draftId: draftIdA,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftIdA}@example.com`,
      taxRate: 0.05,
      items: [{ localItemId: sharedItemId, title: 'Original Title', price: 111 }],
    };
    const resA = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payloadA) }) as any);
    expect(resA.status).toBe(201);

    const draftIdB = randomUUID();
    const payloadB = {
      draftId: draftIdB,
      clientName: 'Someone Else',
      clientEmail: `client-${draftIdB}@example.com`,
      taxRate: 0.05,
      items: [{ localItemId: sharedItemId, title: 'Hijacked Title', price: 999 }],
    };
    const resB = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payloadB) }) as any);
    expect([409, 500]).toContain(resB.status);

    const itemX = await prisma.quoteItem.findUnique({ where: { localItemId: sharedItemId } });
    expect(itemX?.title).toBe('Original Title');
    expect(Number(itemX?.price)).toBe(111);

    const quoteBExists = await prisma.quote.findUnique({ where: { draftId: draftIdB } });
    expect(quoteBExists).toBeNull();
  });

  it('persists clientPhone and serviceAddress, and updates them on resave', async () => {
    const draftId = randomUUID();
    const basePayload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      clientPhone: '(555) 123-4567',
      serviceAddress: '123 Oak St, Springfield',
      taxRate: 0.05,
      items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
    };
    await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(basePayload) }) as any);

    const created = await prisma.quote.findUniqueOrThrow({ where: { draftId }, include: { client: true } });
    expect(created.serviceAddress).toBe('123 Oak St, Springfield');
    expect(created.client.phone).toBe('(555) 123-4567');

    await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, clientPhone: '(555) 999-0000', serviceAddress: '456 Elm St' }),
      }) as any,
    );
    const updated = await prisma.quote.findUniqueOrThrow({ where: { draftId }, include: { client: true } });
    expect(updated.serviceAddress).toBe('456 Elm St');
    expect(updated.client.phone).toBe('(555) 999-0000');
  });

  it('re-points the quote at a new client when the email is edited on resave, instead of silently keeping the old one', async () => {
    const draftId = randomUUID();
    const originalEmail = `original-${draftId}@example.com`;
    const newEmail = `changed-${draftId}@example.com`;
    const basePayload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: originalEmail,
      taxRate: 0.05,
      items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
    };
    await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(basePayload) }) as any);

    await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, clientEmail: newEmail }),
      }) as any,
    );

    const updated = await prisma.quote.findUniqueOrThrow({ where: { draftId }, include: { client: true } });
    expect(updated.client.email).toBe(newEmail);

    // A subsequent GET (what pullServerQuotes reads) must reflect the new
    // email too — not the stale one the quote used to point at.
    const res = await GET();
    const body = await res.json();
    const fetched = body.quotes.find((q: { draftId: string }) => q.draftId === draftId);
    expect(fetched.client.email).toBe(newEmail);
  });

  it('lists quotes', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.quotes)).toBe(true);
  });

  it('a plain save (send: false or omitted) keeps the quote in draft status and sends no email', async () => {
    const draftId = randomUUID();
    const res = await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          clientName: 'Nelson Costa',
          clientEmail: `client-${draftId}@example.com`,
          taxRate: 0.05,
          items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
        }),
      }) as any,
    );
    const body = await res.json();
    expect(body.quote.status).toBe('draft');
    expect(body.quote.sentAt).toBeNull();
    expect(sendQuoteApprovalEmail).not.toHaveBeenCalled();
  });

  it('save and send transitions a new quote to sent and emails the client', async () => {
    const draftId = randomUUID();
    const clientEmail = `client-${draftId}@example.com`;
    const res = await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          clientName: 'Nelson Costa',
          clientEmail,
          taxRate: 0.05,
          items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
          send: true,
        }),
      }) as any,
    );
    const body = await res.json();
    expect(body.quote.status).toBe('sent');
    expect(body.quote.sentAt).not.toBeNull();
    expect(sendQuoteApprovalEmail).toHaveBeenCalledTimes(1);
    expect(sendQuoteApprovalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: clientEmail, clientName: 'Nelson Costa', total: 525 }),
    );
  });

  it('save and send on an already-approved quote resends the email without reverting its status', async () => {
    const draftId = randomUUID();
    const basePayload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      taxRate: 0.05,
      items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
    };
    await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify({ ...basePayload, send: true }) }) as any);
    const created = await prisma.quote.findUniqueOrThrow({ where: { draftId } });
    await prisma.quote.update({ where: { id: created.id }, data: { status: 'approved', respondedAt: new Date() } });
    vi.mocked(sendQuoteApprovalEmail).mockClear();

    const res = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify({ ...basePayload, send: true }) }) as any);
    const body = await res.json();
    expect(body.quote.status).toBe('approved');
    expect(sendQuoteApprovalEmail).toHaveBeenCalledTimes(1);
  });
});

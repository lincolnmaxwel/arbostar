import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/clients/route';
import { DELETE } from '@/app/api/clients/[id]/route';
import { prisma } from '@/lib/db';

describe('GET /api/clients', () => {
  let userId: string;
  let scheduledClientId: string;
  let completedClientId: string;
  let draftOnlyClientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Clients Test', email: `clientsapi-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });

    const scheduledClient = await prisma.client.create({ data: { name: 'Scheduled Client', email: `sched-${randomUUID()}@example.com` } });
    scheduledClientId = scheduledClient.id;
    await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: scheduledClient.id,
        createdById: userId,
        status: 'scheduled',
        serviceAddress: '123 Oak St, Springfield',
      },
    });

    const completedClient = await prisma.client.create({ data: { name: 'Completed Client', email: `comp-${randomUUID()}@example.com` } });
    completedClientId = completedClient.id;
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: completedClient.id, createdById: userId, status: 'completed' },
    });

    const draftOnlyClient = await prisma.client.create({ data: { name: 'Draft Only Client', email: `draft-${randomUUID()}@example.com` } });
    draftOnlyClientId = draftOnlyClient.id;
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: draftOnlyClient.id, createdById: userId, status: 'sent' },
    });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { id: { in: [scheduledClientId, completedClientId, draftOnlyClientId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('includes clients with a scheduled or completed quote', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.clients.map((c: { name: string }) => c.name);
    expect(names).toContain('Scheduled Client');
    expect(names).toContain('Completed Client');
  });

  it('falls back to the most recent confirmed quote\'s service address when Client.address is empty', async () => {
    const res = await GET();
    const body = await res.json();
    const scheduled = body.clients.find((c: { name: string }) => c.name === 'Scheduled Client');
    expect(scheduled.address).toBe('123 Oak St, Springfield');
    expect(scheduled.email).toBeTruthy();
  });

  it('excludes a client whose quotes never got past draft/sent/approved', async () => {
    const res = await GET();
    const body = await res.json();
    const names = body.clients.map((c: { name: string }) => c.name);
    expect(names).not.toContain('Draft Only Client');
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/clients/[id]', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Delete Client Test', email: `delclient-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it('deletes the client and cascades their quotes (and items)', async () => {
    const client = await prisma.client.create({ data: { name: 'Cascade Client', email: `cascade-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'scheduled',
        items: { create: [{ localItemId: randomUUID(), title: 'Hedges', price: 100, sortOrder: 0 }] },
      },
      include: { items: true },
    });

    const res = await DELETE(new Request(`http://localhost/api/clients/${client.id}`, { method: 'DELETE' }) as any, {
      params: { id: client.id },
    });
    expect(res.status).toBe(200);

    expect(await prisma.client.findUnique({ where: { id: client.id } })).toBeNull();
    expect(await prisma.quote.findUnique({ where: { id: quote.id } })).toBeNull();
    expect(await prisma.quoteItem.findUnique({ where: { id: quote.items[0].id } })).toBeNull();
  });

  it('returns 409 (not a raw 500) when a quote still has an invoice, leaving the client intact', async () => {
    const client = await prisma.client.create({ data: { name: 'Invoiced Client', email: `invclient-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: client.id, createdById: userId, status: 'completed' },
    });
    const invoice = await prisma.invoice.create({
      data: { quoteId: quote.id, subtotal: 100, taxRate: 0.05, taxAmount: 5, total: 105 },
    });

    const res = await DELETE(new Request(`http://localhost/api/clients/${client.id}`, { method: 'DELETE' }) as any, {
      params: { id: client.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('has-invoice');

    // The client and quote must still be there — the delete was fully rolled back, not partial.
    expect(await prisma.client.findUnique({ where: { id: client.id } })).not.toBeNull();
    expect(await prisma.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();

    await prisma.invoice.delete({ where: { id: invoice.id } });
    await prisma.quote.delete({ where: { id: quote.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });

  it('returns 404 for a client that does not exist', async () => {
    const res = await DELETE(new Request('http://localhost/api/clients/does-not-exist', { method: 'DELETE' }) as any, {
      params: { id: 'does-not-exist' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await DELETE(new Request('http://localhost/api/clients/anything', { method: 'DELETE' }) as any, {
      params: { id: 'anything' },
    });
    expect(res.status).toBe(401);
  });
});

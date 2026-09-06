import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));

import { getServerSession } from 'next-auth';
import { GET, POST } from '@/app/api/clients/route';
import { DELETE, PATCH } from '@/app/api/clients/[id]/route';
import { GET as listTimesheetClients } from '@/app/api/timesheet/clients/route';
import { prisma } from '@/lib/db';

function postReq(body: unknown) {
  return new Request('http://localhost/api/clients', { method: 'POST', body: JSON.stringify(body) }) as any;
}

describe('GET /api/clients', () => {
  let userId: string;
  let scheduledClientId: string;
  let completedClientId: string;
  let draftOnlyClientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Clients Test', email: `clientsapi-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff', featureFlags: { create: { feature: 'clients_crm', enabled: true } } },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });

    const scheduledClient = await prisma.client.create({ data: { userId: userId, name: 'Scheduled Client', email: `sched-${randomUUID()}@example.com` } });
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

    const completedClient = await prisma.client.create({ data: { userId: userId, name: 'Completed Client', email: `comp-${randomUUID()}@example.com` } });
    completedClientId = completedClient.id;
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: completedClient.id, createdById: userId, status: 'completed' },
    });

    const draftOnlyClient = await prisma.client.create({ data: { userId: userId, name: 'Draft Only Client', email: `draft-${randomUUID()}@example.com` } });
    draftOnlyClientId = draftOnlyClient.id;
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: draftOnlyClient.id, createdById: userId, status: 'sent' },
    });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { userId } });
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

  it('includes a client created manually with no quotes at all', async () => {
    await prisma.client.create({
      data: { userId, name: 'Manual No Quotes', email: `manual-${randomUUID()}@example.com` },
    });
    const res = await GET();
    const body = await res.json();
    const names = body.clients.map((c: { name: string }) => c.name);
    expect(names).toContain('Manual No Quotes');
  });

  it('returns 200 for a user with only the timesheet flag enabled (no clients_crm)', async () => {
    const timesheetOnly = await prisma.user.create({
      data: {
        name: 'Timesheet Only',
        email: `tso-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'timesheet', enabled: true } },
      },
    });
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: { id: timesheetOnly.id } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).clients)).toBe(true);
    await prisma.userFeatureFlag.deleteMany({ where: { userId: timesheetOnly.id } });
    await prisma.user.delete({ where: { id: timesheetOnly.id } });
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/clients (manual creation for timesheet)', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Create Client Test',
        email: `createclient-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: {
          create: [
            { feature: 'timesheet', enabled: true },
            { feature: 'clients_crm', enabled: true },
          ],
        },
      },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('creates a client owned by the effective user', async () => {
    const res = await POST(
      postReq({ name: 'Manual Client', email: `manual-${randomUUID()}@example.com`, phone: '(555) 111-2222', address: '1 Test St' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client.userId).toBe(userId);
    expect(body.client.phone).toBe('(555) 111-2222');
  });

  it('returns 409 email-taken for a duplicate (userId, email) pair', async () => {
    const email = `dup-${randomUUID()}@example.com`;
    await POST(postReq({ name: 'First', email }));
    const res = await POST(postReq({ name: 'Second', email }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('email-taken');
    expect(body.message).toBe('You already have a client with that email.');
  });

  it('returns 400 for invalid payloads', async () => {
    expect((await POST(postReq({ name: '', email: 'x@example.com' }))).status).toBe(400);
    expect((await POST(postReq({ name: 'X', email: 'not-an-email' }))).status).toBe(400);
  });

  it('returns 403 when the timesheet feature is disabled', async () => {
    const noFlag = await prisma.user.create({
      data: { name: 'No Timesheet', email: `nt-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: { id: noFlag.id } });
    const res = await POST(postReq({ name: 'X', email: `x-${randomUUID()}@example.com` }));
    expect(res.status).toBe(403);
    await prisma.user.delete({ where: { id: noFlag.id } });
  });
});

describe('GET /api/timesheet/clients (all owned clients)', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Ts Clients Test',
        email: `tsclients-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'timesheet', enabled: true } },
      },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('lists ALL owned clients — confirmed or not — sorted by name', async () => {
    await prisma.client.create({ data: { userId, name: 'Zed Draft Only', email: `z-${randomUUID()}@example.com` } });
    await prisma.client.create({ data: { userId, name: 'Abe No Quotes', email: `a-${randomUUID()}@example.com` } });
    const confirmed = await prisma.client.create({ data: { userId, name: 'Mid Confirmed', email: `m-${randomUUID()}@example.com` } });
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: confirmed.id, createdById: userId, status: 'scheduled' },
    });

    const res = await listTimesheetClients();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clients.map((c: { name: string }) => c.name)).toEqual(['Abe No Quotes', 'Mid Confirmed', 'Zed Draft Only']);
  });

  it('returns 403 when the timesheet feature is disabled', async () => {
    const noFlag = await prisma.user.create({
      data: { name: 'No Ts', email: `nt2-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: { id: noFlag.id } });
    const res = await listTimesheetClients();
    expect(res.status).toBe(403);
    await prisma.user.delete({ where: { id: noFlag.id } });
  });
});

describe('DELETE /api/clients/[id]', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Delete Client Test', email: `delclient-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff', featureFlags: { create: { feature: 'clients_crm', enabled: true } } },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('deletes the client and cascades their quotes (and items)', async () => {
    const client = await prisma.client.create({ data: { userId: userId, name: 'Cascade Client', email: `cascade-${randomUUID()}@example.com` } });
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

  it('cascades a client whose quote still has an invoice (no more 409 — everything goes)', async () => {
    const client = await prisma.client.create({ data: { userId: userId, name: 'Invoiced Client', email: `invclient-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: client.id, createdById: userId, status: 'completed' },
    });
    const invoice = await prisma.invoice.create({
      data: { quoteId: quote.id, userId, clientId: client.id, subtotal: 100, taxRate: 0.05, taxAmount: 5, total: 105 },
    });

    const res = await DELETE(new Request(`http://localhost/api/clients/${client.id}`, { method: 'DELETE' }) as any, {
      params: { id: client.id },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // The whole subtree is gone: client, quote, and invoice (quote-source
    // invoices are deleted by the cascade; only the invoice delete endpoint
    // keeps blocking them individually).
    expect(await prisma.client.findUnique({ where: { id: client.id } })).toBeNull();
    expect(await prisma.quote.findUnique({ where: { id: quote.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
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

describe('PATCH /api/clients/[id]', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Edit Client Test', email: `editclient-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff', featureFlags: { create: { feature: 'clients_crm', enabled: true } } },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  function patchRequest(body: unknown) {
    return new Request('http://localhost/api/clients/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any;
  }

  it('updates name/email/phone/address', async () => {
    const client = await prisma.client.create({ data: { userId: userId, name: 'Old Name', email: `before-${randomUUID()}@example.com` } });

    const res = await PATCH(
      patchRequest({ name: 'New Name', email: `after-${randomUUID()}@example.com`, phone: '(555) 123-4567', address: '1 New St' }),
      { params: { id: client.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client.name).toBe('New Name');
    expect(body.client.phone).toBe('(555) 123-4567');
    expect(body.client.address).toBe('1 New St');

    await prisma.client.delete({ where: { id: client.id } });
  });

  it('returns 409 (not a raw 500) when the new email is already used by another client', async () => {
    const clientA = await prisma.client.create({ data: { userId: userId, name: 'Client A', email: `a-${randomUUID()}@example.com` } });
    const clientB = await prisma.client.create({ data: { userId: userId, name: 'Client B', email: `b-${randomUUID()}@example.com` } });

    const res = await PATCH(patchRequest({ name: 'Client B', email: clientA.email }), { params: { id: clientB.id } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('email-taken');

    // Untouched by the failed update.
    const stillClientB = await prisma.client.findUnique({ where: { id: clientB.id } });
    expect(stillClientB?.email).not.toBe(clientA.email);

    await prisma.client.delete({ where: { id: clientA.id } });
    await prisma.client.delete({ where: { id: clientB.id } });
  });

  it('returns 400 for an invalid email', async () => {
    const client = await prisma.client.create({ data: { userId: userId, name: 'Client', email: `valid-${randomUUID()}@example.com` } });
    const res = await PATCH(patchRequest({ name: 'Client', email: 'not-an-email' }), { params: { id: client.id } });
    expect(res.status).toBe(400);
    await prisma.client.delete({ where: { id: client.id } });
  });

  it('returns 404 for a client that does not exist', async () => {
    const res = await PATCH(patchRequest({ name: 'X', email: `x-${randomUUID()}@example.com` }), { params: { id: 'does-not-exist' } });
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await PATCH(patchRequest({ name: 'X', email: 'x@example.com' }), { params: { id: 'anything' } });
    expect(res.status).toBe(401);
  });
});

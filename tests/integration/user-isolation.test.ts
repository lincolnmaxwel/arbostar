import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const { cookieGetMock } = vi.hoisted(() => ({ cookieGetMock: vi.fn() }));

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('next/headers', () => ({
  cookies: () => ({ get: cookieGetMock }),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { GET as listQuotes, POST as upsertQuote } from '@/app/api/quotes/route';
import { GET as getQuote, DELETE as deleteQuote } from '@/app/api/quotes/[id]/route';
import { GET as listClients } from '@/app/api/clients/route';
import { PATCH as patchClient, DELETE as deleteClient } from '@/app/api/clients/[id]/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

describe('per-user isolation on clients and quotes', () => {
  let userAId: string;
  let userBId: string;
  let adminId: string;
  let clientAId: string;
  let clientBId: string;
  let quoteAId: string;
  let quoteBId: string;

  beforeAll(async () => {
    const ua = await prisma.user.create({
      data: {
        name: 'Isolation A',
        email: `iso-a-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: [{ feature: 'clients_crm', enabled: true }, { feature: 'quotes', enabled: true }] },
      },
    });
    userAId = ua.id;
    const ub = await prisma.user.create({
      data: {
        name: 'Isolation B',
        email: `iso-b-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: [{ feature: 'clients_crm', enabled: true }, { feature: 'quotes', enabled: true }] },
      },
    });
    userBId = ub.id;
    const adm = await prisma.user.create({
      data: { name: 'Isolation Admin', email: `iso-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = adm.id;

    // Same-email clients, one per owner — the per-user unique key allows it.
    const sharedEmail = `shared-${randomUUID()}@example.com`;
    const clientA = await prisma.client.create({
      data: { userId: userAId, name: 'Shared Name', email: sharedEmail },
    });
    clientAId = clientA.id;
    const clientB = await prisma.client.create({
      data: { userId: userBId, name: 'Shared Name', email: sharedEmail },
    });
    clientBId = clientB.id;

    const quoteA = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: clientAId,
        createdById: userAId,
        status: 'scheduled',
        items: { create: [{ localItemId: randomUUID(), title: 'A service', price: 100, sortOrder: 0 }] },
      },
    });
    quoteAId = quoteA.id;
    const quoteB = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: clientBId,
        createdById: userBId,
        status: 'scheduled',
        items: { create: [{ localItemId: randomUUID(), title: 'B service', price: 200, sortOrder: 0 }] },
      },
    });
    quoteBId = quoteB.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.invoice.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.quote.deleteMany({ where: { createdById: { in: [userAId, userBId] } } });
    await prisma.client.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId, adminId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    cookieGetMock.mockReset();
    cookieGetMock.mockReturnValue(undefined);
  });

  function asUser(id: string) {
    sessionMock.mockResolvedValue({ user: { id } });
  }

  it('lists only the owner\'s clients', async () => {
    asUser(userAId);
    const res = await listClients();
    const body = await res.json();
    const ids = body.clients.map((c: { id: string }) => c.id);
    expect(ids).toContain(clientAId);
    expect(ids).not.toContain(clientBId);
  });

  it('lists only the owner\'s quotes', async () => {
    asUser(userAId);
    const res = await listQuotes();
    const body = await res.json();
    const ids = body.quotes.map((q: { id: string }) => q.id);
    expect(ids).toContain(quoteAId);
    expect(ids).not.toContain(quoteBId);
  });

  it('treats another owner\'s quote id as 404 on get and delete', async () => {
    asUser(userAId);
    const getRes = await getQuote(new Request(`http://localhost/api/quotes/${quoteBId}`) as any, {
      params: { id: quoteBId },
    });
    expect(getRes.status).toBe(404);

    const delRes = await deleteQuote(new Request(`http://localhost/api/quotes/${quoteBId}`, { method: 'DELETE' }) as any, {
      params: { id: quoteBId },
    });
    expect(delRes.status).toBe(404);
    expect(await prisma.quote.findUnique({ where: { id: quoteBId } })).not.toBeNull();
  });

  it('treats another owner\'s client id as 404 on patch and delete', async () => {
    asUser(userAId);
    const patchRes = await patchClient(
      new Request(`http://localhost/api/clients/${clientBId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Hijack', email: `hijack-${randomUUID()}@example.com` }),
      }) as any,
      { params: { id: clientBId } },
    );
    expect(patchRes.status).toBe(404);

    const delRes = await deleteClient(new Request(`http://localhost/api/clients/${clientBId}`, { method: 'DELETE' }) as any, {
      params: { id: clientBId },
    });
    expect(delRes.status).toBe(404);
    expect(await prisma.client.findUnique({ where: { id: clientBId } })).not.toBeNull();
  });

  it('quote sync with a same-email client creates a separate client per owner', async () => {
    const draftId = randomUUID();
    const email = `synced-shared-${randomUUID()}@example.com`;
    const payload = {
      draftId,
      clientName: 'Sync Shared',
      clientEmail: email,
      taxRate: 0.05,
      items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
    };

    asUser(userAId);
    const resA = await upsertQuote(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payload) }) as any);
    expect(resA.status).toBe(201);

    // Draft ids are device-minted UUIDs — user B syncs their own draft id
    // and their own local item ids.
    const payloadB = {
      ...payload,
      draftId: randomUUID(),
      items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
    };
    asUser(userBId);
    const resB = await upsertQuote(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payloadB) }) as any);
    expect(resB.status).toBe(201);

    const clients = await prisma.client.findMany({ where: { email } });
    expect(clients).toHaveLength(2);
    expect(clients.map((c) => c.userId).sort()).toEqual([userAId, userBId].sort());

    // Each quote points at its own owner's client row.
    const qB = await prisma.quote.findUniqueOrThrow({ where: { draftId: payloadB.draftId } });
    const clientOfB = await prisma.client.findUniqueOrThrow({ where: { id: qB.clientId } });
    expect(clientOfB.userId).toBe(userBId);
  });

  it('an admin viewing as user B can edit B\'s client with an audit row identifying the real actor', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieGetMock.mockReturnValue({ value: userBId });

    const res = await patchClient(
      new Request(`http://localhost/api/clients/${clientBId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Edited As B', email: `edited-b-${randomUUID()}@example.com` }),
      }) as any,
      { params: { id: clientBId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client.name).toBe('Edited As B');

    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientBId } });
    expect(client.userId).toBe(userBId);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, targetUserId: userBId, entityType: 'Client', entityId: clientBId },
    });
    expect(audit).not.toBeNull();
  });
});
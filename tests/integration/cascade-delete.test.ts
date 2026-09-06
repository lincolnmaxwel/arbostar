import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, access } from 'fs/promises';
import path from 'path';

const { cookieGetMock } = vi.hoisted(() => ({ cookieGetMock: vi.fn() }));

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('next/headers', () => ({
  cookies: () => ({ get: cookieGetMock }),
}));
vi.mock('@/lib/email', () => ({
  sendInvoiceEmail: vi.fn().mockResolvedValue(undefined),
  sendQuoteApprovalEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { deleteClientCascade, deleteInvoiceCascade, deleteUserCascade } from '@/lib/cascadeDelete';
import { DELETE as deleteTimesheetEntry } from '@/app/api/timesheet/[id]/route';
import { DELETE as deleteClient } from '@/app/api/clients/[id]/route';
import { DELETE as deleteAdminUser } from '@/app/api/admin/users/[id]/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

async function pathExists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function makeQuoteUploadDir(quoteId: string) {
  const dir = path.join(process.cwd(), 'uploads', 'quotes', quoteId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8]));
  return dir;
}

describe('deleteInvoiceCascade', () => {
  let userId: string;
  let clientId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Cascade Inv', email: `cascade-inv-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    const client = await prisma.client.create({
      data: { userId, name: 'Cascade Inv Client', email: `ci-${randomUUID()}@example.com` },
    });
    clientId = client.id;
    const invoice = await prisma.invoice.create({
      data: {
        source: 'timesheet',
        userId,
        clientId,
        subtotal: 100,
        taxRate: 0.05,
        taxAmount: 5,
        total: 105,
        lineItems: { create: [{ description: 'Labor', quantity: 2, unitPrice: 50, amount: 100, sortOrder: 0 }] },
      },
    });
    invoiceId = invoice.id;
    await prisma.timesheetEntry.create({
      data: {
        userId,
        clientId,
        workDate: new Date('2026-09-01T12:00:00.000Z'),
        startedAt: new Date('2026-09-01T13:00:00.000Z'),
        endedAt: new Date('2026-09-01T15:00:00.000Z'),
        durationMinutes: 120,
        hourlyRate: 50,
        description: 'Seeded work description',
        status: 'invoiced',
        invoiceId,
      },
    });
    await prisma.timesheetEntry.create({
      data: {
        userId,
        clientId,
        workDate: new Date('2026-09-02T12:00:00.000Z'),
        startedAt: new Date('2026-09-02T13:00:00.000Z'),
        endedAt: new Date('2026-09-02T15:00:00.000Z'),
        durationMinutes: 120,
        hourlyRate: 50,
        description: 'Seeded work description',
        status: 'invoiced',
        invoiceId,
      },
    });
  });

  afterAll(async () => {
    await prisma.timesheetEntry.deleteMany({ where: { userId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { userId } } });
    await prisma.invoice.deleteMany({ where: { userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('deletes the invoice, its line items, and every attached entry; reports the entry count', async () => {
    const count = await prisma.$transaction((tx) => deleteInvoiceCascade(tx, invoiceId));
    expect(count).toBe(2);
    expect(await prisma.invoice.findUnique({ where: { id: invoiceId } })).toBeNull();
    expect(await prisma.invoiceLineItem.count({ where: { invoiceId } })).toBe(0);
    expect(await prisma.timesheetEntry.count({ where: { userId } })).toBe(0);
  });
});

describe('deleteClientCascade', () => {
  let userId: string;
  let clientId: string;
  let quoteId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Cascade Client', email: `cascade-client-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    const client = await prisma.client.create({
      data: { userId, name: 'Cascade Client Row', email: `cc-${randomUUID()}@example.com` },
    });
    clientId = client.id;
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId,
        createdById: userId,
        status: 'scheduled',
        subtotal: 100,
        taxRate: 0.05,
        taxAmount: 5,
        total: 105,
        items: { create: [{ localItemId: randomUUID(), title: 'Service', price: 100, sortOrder: 0 }] },
      },
      include: { items: true },
    });
    quoteId = quote.id;
    await prisma.invoice.create({
      data: { source: 'quote', quoteId, userId, clientId, subtotal: 100, taxRate: 0.05, taxAmount: 5, total: 105 },
    });
    await prisma.timesheetEntry.create({
      data: {
        userId,
        clientId,
        workDate: new Date('2026-09-01T12:00:00.000Z'),
        startedAt: new Date('2026-09-01T13:00:00.000Z'),
        endedAt: new Date('2026-09-01T14:00:00.000Z'),
        durationMinutes: 60,
        hourlyRate: 50,
        description: 'Seeded work description',
      },
    });
  });

  afterAll(async () => {
    await prisma.timesheetEntry.deleteMany({ where: { userId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { userId } } });
    await prisma.invoice.deleteMany({ where: { userId } });
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('removes client, quotes (with items), invoice, and timesheet entries — zero orphans', async () => {
    const { quoteIds } = await deleteClientCascade(clientId);
    expect(quoteIds).toContain(quoteId);
    expect(await prisma.client.findUnique({ where: { id: clientId } })).toBeNull();
    expect(await prisma.quote.findUnique({ where: { id: quoteId } })).toBeNull();
    expect(await prisma.quoteItem.count({ where: { quoteId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { clientId } })).toBe(0);
    expect(await prisma.timesheetEntry.count({ where: { clientId } })).toBe(0);
  });
});

describe('deleteUserCascade + DELETE /api/admin/users/[id]', () => {
  let actorAdminId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Cascade Admin', email: `cascade-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    actorAdminId = admin.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: actorAdminId } });
    await prisma.user.deleteMany({ where: { id: actorAdminId } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    cookieGetMock.mockReset();
    cookieGetMock.mockReturnValue(undefined);
    sessionMock.mockResolvedValue({ user: { id: actorAdminId } });
  });

  it('removes a user and everything they own, and cleans up quote uploads + company logo', async () => {
    const target = await prisma.user.create({
      data: {
        name: 'Cascade Target',
        email: `cascade-target-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'timesheet', enabled: true } },
        serviceCatalogItems: { create: { name: 'Chips', defaultPrice: 25 } },
        companyProfile: { create: { name: 'Target Co', logoPath: 'target-logo.png' } },
      },
    });
    const client = await prisma.client.create({
      data: { userId: target.id, name: 'Target Client', email: `tc-${randomUUID()}@example.com` },
    });
    const quote = await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: client.id, createdById: target.id, status: 'scheduled' },
    });
    await prisma.invoice.create({
      data: { source: 'quote', quoteId: quote.id, userId: target.id, clientId: client.id, subtotal: 100, taxRate: 0.05, taxAmount: 5, total: 105 },
    });
    await prisma.timesheetEntry.create({
      data: {
        userId: target.id,
        clientId: client.id,
        workDate: new Date('2026-09-01T12:00:00.000Z'),
        startedAt: new Date('2026-09-01T13:00:00.000Z'),
        endedAt: new Date('2026-09-01T14:00:00.000Z'),
        durationMinutes: 60,
        hourlyRate: 50,
        description: 'Seeded work description',
      },
    });
    const quoteDir = await makeQuoteUploadDir(quote.id);
    const logoDir = path.join(process.cwd(), 'uploads', 'company');
    await mkdir(logoDir, { recursive: true });
    await writeFile(path.join(logoDir, 'target-logo.png'), Buffer.from([0x89, 0x50]));

    const res = await deleteAdminUser(new Request(`http://localhost/api/admin/users/${target.id}`, { method: 'DELETE' }) as any, {
      params: { id: target.id },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await prisma.client.findUnique({ where: { id: client.id } })).toBeNull();
    expect(await prisma.quote.findUnique({ where: { id: quote.id } })).toBeNull();
    expect(await prisma.invoice.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.timesheetEntry.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.companyProfile.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.userFeatureFlag.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.serviceCatalogItem.count({ where: { userId: target.id } })).toBe(0);

    expect(await pathExists(quoteDir)).toBe(false);
    expect(await pathExists(path.join(logoDir, 'target-logo.png'))).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: actorAdminId, entityType: 'User', entityId: target.id, action: 'delete' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses to delete the admin\'s own account', async () => {
    const res = await deleteAdminUser(new Request(`http://localhost/api/admin/users/${actorAdminId}`, { method: 'DELETE' }) as any, {
      params: { id: actorAdminId },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('You cannot delete your own account.');
    expect(await prisma.user.findUnique({ where: { id: actorAdminId } })).not.toBeNull();
  });

  it('deletes another admin while one remains active (never blocks incorrectly)', async () => {
    const otherAdmin = await prisma.user.create({
      data: { name: 'Cascade Admin 2', email: `cascade-admin2-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    const res = await deleteAdminUser(new Request(`http://localhost/api/admin/users/${otherAdmin.id}`, { method: 'DELETE' }) as any, {
      params: { id: otherAdmin.id },
    });
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: otherAdmin.id } })).toBeNull();
  });

  it('returns 404 for an unknown user and 401 without a session', async () => {
    const res = await deleteAdminUser(new Request('http://localhost/api/admin/users/nope', { method: 'DELETE' }) as any, {
      params: { id: 'nope' },
    });
    expect(res.status).toBe(404);

    sessionMock.mockResolvedValue(null);
    const res401 = await deleteAdminUser(new Request('http://localhost/api/admin/users/nope', { method: 'DELETE' }) as any, {
      params: { id: 'nope' },
    });
    expect(res401.status).toBe(401);
  });
});

describe('DELETE /api/timesheet/[id] with an invoiced entry', () => {
  let userId: string;
  let clientId: string;
  let invoiceId: string;
  let entryAId: string;
  let entryBId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Ts Cascade',
        email: `ts-cascade-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'timesheet', enabled: true } },
      },
    });
    userId = user.id;
    const client = await prisma.client.create({
      data: { userId, name: 'Ts Cascade Client', email: `tsc-${randomUUID()}@example.com` },
    });
    clientId = client.id;
    const invoice = await prisma.invoice.create({
      data: {
        source: 'timesheet',
        userId,
        clientId,
        subtotal: 200,
        taxRate: 0.05,
        taxAmount: 10,
        total: 210,
        lineItems: { create: [{ description: 'Labor', quantity: 4, unitPrice: 50, amount: 200, sortOrder: 0 }] },
      },
    });
    invoiceId = invoice.id;
    const a = await prisma.timesheetEntry.create({
      data: {
        userId,
        clientId,
        workDate: new Date('2026-09-01T12:00:00.000Z'),
        startedAt: new Date('2026-09-01T13:00:00.000Z'),
        endedAt: new Date('2026-09-01T15:00:00.000Z'),
        durationMinutes: 120,
        hourlyRate: 50,
        description: 'Seeded work description',
        status: 'invoiced',
        invoiceId,
      },
    });
    entryAId = a.id;
    const b = await prisma.timesheetEntry.create({
      data: {
        userId,
        clientId,
        workDate: new Date('2026-09-02T12:00:00.000Z'),
        startedAt: new Date('2026-09-02T13:00:00.000Z'),
        endedAt: new Date('2026-09-02T15:00:00.000Z'),
        durationMinutes: 120,
        hourlyRate: 50,
        description: 'Seeded work description',
        status: 'invoiced',
        invoiceId,
      },
    });
    entryBId = b.id;
    sessionMock.mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.timesheetEntry.deleteMany({ where: { userId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { userId } } });
    await prisma.invoice.deleteMany({ where: { userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('deleting one invoiced entry deletes the whole invoice and its sibling entries', async () => {
    const res = await deleteTimesheetEntry(new Request(`http://localhost/api/timesheet/${entryAId}`, { method: 'DELETE' }) as any, {
      params: { id: entryAId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.invoiceDeleted).toBe(true);
    expect(typeof body.invoiceNumber).toBe('number');
    expect(body.entriesDeleted).toBe(2);

    expect(await prisma.timesheetEntry.findUnique({ where: { id: entryAId } })).toBeNull();
    expect(await prisma.timesheetEntry.findUnique({ where: { id: entryBId } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: invoiceId } })).toBeNull();
    expect(await prisma.invoiceLineItem.count({ where: { invoiceId } })).toBe(0);
  });

  it('deletes a plain open entry with ok:true only', async () => {
    const open = await prisma.timesheetEntry.create({
      data: {
        userId,
        clientId,
        workDate: new Date('2026-09-03T12:00:00.000Z'),
        startedAt: new Date('2026-09-03T13:00:00.000Z'),
        endedAt: new Date('2026-09-03T14:00:00.000Z'),
        durationMinutes: 60,
        hourlyRate: 50,
        description: 'Seeded work description',
      },
    });
    const res = await deleteTimesheetEntry(new Request(`http://localhost/api/timesheet/${open.id}`, { method: 'DELETE' }) as any, {
      params: { id: open.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(await prisma.timesheetEntry.findUnique({ where: { id: open.id } })).toBeNull();
  });
});

describe('DELETE /api/clients/[id] cascade', () => {
  let userId: string;
  let clientId: string;
  let quoteId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Client Cascade',
        email: `client-cascade-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'clients_crm', enabled: true } },
      },
    });
    userId = user.id;
    const client = await prisma.client.create({
      data: { userId, name: 'Client Cascade Row', email: `ccr-${randomUUID()}@example.com` },
    });
    clientId = client.id;
    const quote = await prisma.quote.create({
      data: { draftId: randomUUID(), clientId, createdById: userId, status: 'completed' },
    });
    quoteId = quote.id;
    await prisma.invoice.create({
      data: { source: 'quote', quoteId, userId, clientId, subtotal: 100, taxRate: 0.05, taxAmount: 5, total: 105 },
    });
    await prisma.timesheetEntry.create({
      data: {
        userId,
        clientId,
        workDate: new Date('2026-09-01T12:00:00.000Z'),
        startedAt: new Date('2026-09-01T13:00:00.000Z'),
        endedAt: new Date('2026-09-01T14:00:00.000Z'),
        durationMinutes: 60,
        hourlyRate: 50,
        description: 'Seeded work description',
      },
    });
    sessionMock.mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.timesheetEntry.deleteMany({ where: { userId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { userId } } });
    await prisma.invoice.deleteMany({ where: { userId } });
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('deletes the client even with invoice + timesheet entries attached, cleaning quote uploads', async () => {
    const quoteDir = await makeQuoteUploadDir(quoteId);

    const res = await deleteClient(new Request(`http://localhost/api/clients/${clientId}`, { method: 'DELETE' }) as any, {
      params: { id: clientId },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    expect(await prisma.client.findUnique({ where: { id: clientId } })).toBeNull();
    expect(await prisma.quote.findUnique({ where: { id: quoteId } })).toBeNull();
    expect(await prisma.invoice.count({ where: { clientId } })).toBe(0);
    expect(await prisma.timesheetEntry.count({ where: { clientId } })).toBe(0);
    expect(await pathExists(quoteDir)).toBe(false);
  });
});
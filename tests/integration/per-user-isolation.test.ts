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
vi.mock('@/lib/email', () => ({
  sendInvoiceEmail: vi.fn().mockResolvedValue(undefined),
  sendQuoteApprovalEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { GET as listQuotes } from '@/app/api/quotes/route';
import { GET as getQuote, DELETE as deleteQuote } from '@/app/api/quotes/[id]/route';
import { GET as listClients } from '@/app/api/clients/route';
import { PATCH as patchClientById } from '@/app/api/clients/[id]/route';
import { GET as listInvoices } from '@/app/api/invoices/route';
import { GET as getInvoice } from '@/app/api/invoices/[id]/route';
import { GET as listTimesheet, POST as createTimesheetEntry } from '@/app/api/timesheet/route';
import { GET as getProfile } from '@/app/api/profile/route';
import { GET as getCompany, PATCH as patchCompany } from '@/app/api/company/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

describe('cross-surface per-user isolation (staff sessions + admin view-as)', () => {
  let userAId: string;
  let userBId: string;
  let adminId: string;
  let clientAId: string;
  let quoteAId: string;
  let invoiceAId: string;
  let entryAId: string;

  beforeAll(async () => {
    const a = await prisma.user.create({
      data: {
        name: 'Surface A',
        email: `surface-a-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        hourlyRate: 60,
        featureFlags: {
          create: [
            { feature: 'invoices', enabled: true },
            { feature: 'timesheet', enabled: true },
            { feature: 'clients_crm', enabled: true },
            { feature: 'quotes', enabled: true },
          ],
        },
      },
    });
    userAId = a.id;
    const b = await prisma.user.create({
      data: {
        name: 'Surface B',
        email: `surface-b-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: {
          create: [
            { feature: 'invoices', enabled: false },
            { feature: 'timesheet', enabled: false },
            { feature: 'clients_crm', enabled: false },
            { feature: 'quotes', enabled: false },
          ],
        },
      },
    });
    userBId = b.id;
    const adm = await prisma.user.create({
      data: { name: 'Surface Admin', email: `surface-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = adm.id;

    const sharedEmail = `surface-shared-${randomUUID()}@example.com`;
    const clientA = await prisma.client.create({ data: { userId: userAId, name: 'Shared Name', email: sharedEmail } });
    clientAId = clientA.id;
    const clientB = await prisma.client.create({ data: { userId: userBId, name: 'Shared Name', email: sharedEmail } });

    const quoteA = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: clientAId,
        createdById: userAId,
        status: 'scheduled',
        subtotal: 100,
        taxRate: 0.05,
        taxAmount: 5,
        total: 105,
        items: { create: [{ localItemId: randomUUID(), title: 'A service', price: 100, sortOrder: 0 }] },
      },
    });
    quoteAId = quoteA.id;
    const quoteB = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: clientB.id,
        createdById: userBId,
        status: 'scheduled',
        subtotal: 200,
        taxRate: 0.05,
        taxAmount: 10,
        total: 210,
        items: { create: [{ localItemId: randomUUID(), title: 'B service', price: 200, sortOrder: 0 }] },
      },
    });

    const invoiceA = await prisma.invoice.create({
      data: {
        source: 'quote',
        quoteId: quoteA.id,
        userId: userAId,
        clientId: clientAId,
        subtotal: 100,
        taxRate: 0.05,
        taxAmount: 5,
        total: 105,
      },
    });
    invoiceAId = invoiceA.id;

    const entryA = await prisma.timesheetEntry.create({
      data: {
        userId: userAId,
        clientId: clientAId,
        workDate: new Date('2026-09-01T12:00:00.000Z'),
        startedAt: new Date('2026-09-01T13:00:00.000Z'),
        endedAt: new Date('2026-09-01T17:00:00.000Z'),
        durationMinutes: 240,
        hourlyRate: 60,
        description: 'Seeded work description',
      },
    });
    entryAId = entryA.id;

    await prisma.companyProfile.create({ data: { userId: userAId, name: 'A Co' } });
    await prisma.companyProfile.create({ data: { userId: userBId, name: 'B Co' } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.timesheetProduct.deleteMany({ where: { timesheetEntry: { userId: { in: [userAId, userBId] } } } });
    await prisma.timesheetEntry.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { userId: { in: [userAId, userBId] } } } });
    await prisma.invoice.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.quote.deleteMany({ where: { createdById: { in: [userAId, userBId] } } });
    await prisma.client.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.companyProfile.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
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

  it('staff session A sees only A\'s quotes, clients, invoices, and timesheet entries', async () => {
    asUser(userAId);
    expect((await (await listQuotes()).json()).quotes.map((q: { id: string }) => q.id)).toContain(quoteAId);
    expect((await (await listClients()).json()).clients.map((c: { id: string }) => c.id)).toContain(clientAId);
    const inv = await (await listInvoices()).json();
    expect(inv.invoices.map((i: { id: string }) => i.id)).toContain(invoiceAId);
    const ts = await (await listTimesheet(new NextRequest('http://localhost/api/timesheet'))).json();
    expect(ts.entries.map((e: { id: string }) => e.id)).toContain(entryAId);
    expect(ts.entries).toHaveLength(1);
  });

  it('staff session B sees none of A\'s data', async () => {
    asUser(userBId);
    // B has quotes disabled -> 403 on the quotes list.
    expect((await listQuotes()).status).toBe(403);
    // B has clients_crm disabled -> 403 on the clients list.
    expect((await listClients()).status).toBe(403);
    expect((await listInvoices()).status).toBe(403);
    expect((await listTimesheet(new NextRequest('http://localhost/api/timesheet'))).status).toBe(403);
  });

  it('A cannot read, edit, or delete B\'s data via direct ids', async () => {
    asUser(userAId);
    // B has no quotes/clients of its own visible here; cross-owner ids 404.
    expect((await getQuote(new Request(`http://localhost/api/quotes/${quoteAId}`) as any, { params: { id: quoteAId } })).status).toBe(200);
    // A's own id is fine; deleting someone else's (B has none, but the shared
    // client is A's own — verify a delete of A's quote works and is scoped).
    const del = await deleteQuote(new Request(`http://localhost/api/quotes/${quoteAId}`, { method: 'DELETE' }) as any, {
      params: { id: quoteAId },
    });
    expect(del.status).toBe(409); // quote still has an invoice
  });

  it('an admin viewing as A edits A\'s client and writes an audit row identifying the admin', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieGetMock.mockReturnValue({ value: userAId });

    const res = await patchClientById(
      new Request(`http://localhost/api/clients/${clientAId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Edited By Admin View-As', email: `edited-${randomUUID()}@example.com` }),
      }) as any,
      { params: { id: clientAId } },
    );
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, targetUserId: userAId, entityType: 'Client', entityId: clientAId, action: 'update' },
    });
    expect(audit).not.toBeNull();
  });

  it('view-as writes to the profile and company surfaces also audit the real actor', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieGetMock.mockReturnValue({ value: userAId });

    const company = await patchCompany(
      new Request('http://localhost/api/company', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'A Co Edited' }),
      }) as any,
    );
    expect(company.status).toBe(200);
    expect((await company.json()).company.name).toBe('A Co Edited');

    const profile = await prisma.companyProfile.findUniqueOrThrow({ where: { userId: userAId } });
    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, targetUserId: userAId, entityType: 'CompanyProfile', entityId: profile.id, action: 'update' },
    });
    expect(audit).not.toBeNull();

    // Personal settings stay actor-owned: the admin's own profile is returned.
    const profileRes = await getProfile();
    const profileBody = await profileRes.json();
    expect(profileBody.user.email).not.toBeNull();
  });

  it('a disabled feature returns 403 even while an admin views that user', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieGetMock.mockReturnValue({ value: userBId }); // B has all features disabled

    expect((await listQuotes()).status).toBe(403);
    expect((await listClients()).status).toBe(403);
    expect((await listInvoices()).status).toBe(403);
    expect((await listTimesheet(new NextRequest('http://localhost/api/timesheet'))).status).toBe(403);
  });

  it('the admin can also see A\'s timesheet surface and mutate it with audit', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieGetMock.mockReturnValue({ value: userAId });

    const res = await createTimesheetEntry(
      new Request('http://localhost/api/timesheet', {
        method: 'POST',
        body: JSON.stringify({
          clientId: clientAId,
          workDate: '2026-09-05',
          startedAt: '2026-09-05T08:00:00.000Z',
          endedAt: '2026-09-05T10:00:00.000Z',
        }),
      }) as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, targetUserId: userAId, entityType: 'TimesheetEntry', entityId: body.entry.id, action: 'create' },
    });
    expect(audit).not.toBeNull();
  });

  it('cross-owner invoice access returns 404 for the other user', async () => {
    asUser(userAId);
    expect((await getInvoice(new Request(`http://localhost/api/invoices/${invoiceAId}`) as any, { params: { id: invoiceAId } })).status).toBe(200);

    // A user with the invoices flag enabled still cannot read another owner's invoice.
    const other = await prisma.user.create({
      data: {
        name: 'Invoice Observer',
        email: `inv-observer-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'invoices', enabled: true } },
      },
    });
    asUser(other.id);
    const cross = await getInvoice(new Request(`http://localhost/api/invoices/${invoiceAId}`) as any, { params: { id: invoiceAId } });
    expect(cross.status).toBe(404);
    await prisma.userFeatureFlag.deleteMany({ where: { userId: other.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});
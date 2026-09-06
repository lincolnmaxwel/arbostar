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
vi.mock('@/lib/email', () => ({ sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) }));

import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { GET as listEntries, POST as createEntry } from '@/app/api/timesheet/route';
import { PATCH as patchEntry, DELETE as deleteEntry } from '@/app/api/timesheet/[id]/route';
import { POST as generateInvoice } from '@/app/api/timesheet/invoice/route';
import { sendInvoiceEmail } from '@/lib/email';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

describe('timesheet API', () => {
  let userId: string;
  let clientId: string;
  let entryIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Timesheet User',
        email: `timesheet-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        hourlyRate: 50,
        featureFlags: { create: { feature: 'timesheet', enabled: true } },
      },
    });
    userId = user.id;
    const client = await prisma.client.create({
      data: { userId, name: 'Timesheet Client', email: `ts-client-${randomUUID()}@example.com` },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.timesheetProduct.deleteMany({ where: { timesheetEntry: { userId } } });
    await prisma.timesheetEntry.deleteMany({ where: { userId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { userId } } });
    await prisma.invoice.deleteMany({ where: { userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.companyProfile.deleteMany({ where: { userId } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    cookieGetMock.mockReset();
    cookieGetMock.mockReturnValue(undefined);
    sessionMock.mockResolvedValue({ user: { id: userId } });
    vi.mocked(sendInvoiceEmail).mockClear();
  });

  function entryPayload(overrides: Record<string, unknown> = {}) {
    return {
      clientId,
      workDate: '2026-09-01',
      startedAt: '2026-09-01T13:00:00.000Z',
      endedAt: '2026-09-01T16:30:00.000Z',
      description: 'Test work description',
      ...overrides,
    };
  }

  async function createOpenEntry(overrides: Record<string, unknown> = {}) {
    const res = await createEntry(
      new Request('http://localhost/api/timesheet', {
        method: 'POST',
        body: JSON.stringify(entryPayload(overrides)),
      }) as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    entryIds.push(body.entry.id);
    return body.entry as { id: string; durationMinutes: number; hourlyRate: string; description: string; products: unknown[] };
  }

  it('rejects unauthenticated access and the disabled feature', async () => {
    sessionMock.mockResolvedValue(null);
    expect((await listEntries(new Request('http://localhost/api/timesheet') as any)).status).toBe(401);

    const noFlag = await prisma.user.create({
      data: { name: 'No Timesheet', email: `nots-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    sessionMock.mockResolvedValue({ user: { id: noFlag.id } });
    expect((await listEntries(new Request('http://localhost/api/timesheet') as any)).status).toBe(403);
    await prisma.user.delete({ where: { id: noFlag.id } });
  });

  it('creates an entry snapshotting the user hourly rate and computing duration', async () => {
    const entry = await createOpenEntry();
    expect(entry.durationMinutes).toBe(210);
    expect(Number(entry.hourlyRate)).toBe(50);
  });

  it('creates an entry with products and Decimal-safe line totals', async () => {
    const entry = await createOpenEntry({
      products: [{ name: 'Chips', quantity: 2.5, unitPrice: 12.34 }],
    });
    expect(entry.products).toHaveLength(1);
    const created = await prisma.timesheetProduct.findFirst({ where: { timesheetEntryId: entry.id } });
    expect(Number(created?.lineTotal)).toBe(30.85);
  });

  it('creates an entry with a trimmed description and returns it in the response', async () => {
    const entry = await createOpenEntry({ description: '  Pruned oaks and cleared the drive  ' });
    expect(entry.description).toBe('Pruned oaks and cleared the drive');
    const stored = await prisma.timesheetEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.description).toBe('Pruned oaks and cleared the drive');
  });

  it('rejects a create without a description (400, Description is required.)', async () => {
    const missing = await createEntry(
      new Request('http://localhost/api/timesheet', {
        method: 'POST',
        body: JSON.stringify(entryPayload({ description: undefined })),
      }) as any,
    );
    expect(missing.status).toBe(400);

    const blank = await createEntry(
      new Request('http://localhost/api/timesheet', {
        method: 'POST',
        body: JSON.stringify(entryPayload({ description: '   ' })),
      }) as any,
    );
    expect(blank.status).toBe(400);
    const body = await blank.json();
    expect(JSON.stringify(body.error)).toContain('Description is required.');
  });

  it('lists entries including the description', async () => {
    await createOpenEntry({ workDate: '2026-09-07', description: 'Hedge trimming' });
    const res = await listEntries(new NextRequest('http://localhost/api/timesheet'));
    const body = await res.json();
    const found = body.entries.find((e: { description: string }) => e.description === 'Hedge trimming');
    expect(found).toBeDefined();
  });

  it('PATCH updates and preserves the description on open entries (blank is rejected)', async () => {
    const entry = await createOpenEntry({ description: 'First note' });

    const res = await patchEntry(
      new Request(`http://localhost/api/timesheet/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'Second note' }),
      }) as any,
      { params: { id: entry.id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entry.description).toBe('Second note');

    // Blank description is rejected — description is required, never nulled.
    const blank = await patchEntry(
      new Request(`http://localhost/api/timesheet/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: '   ' }),
      }) as any,
      { params: { id: entry.id } },
    );
    expect(blank.status).toBe(400);

    // Omitting description leaves the stored value untouched.
    const untouched = await patchEntry(
      new Request(`http://localhost/api/timesheet/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ endedAt: '2026-09-01T18:30:00.000Z' }),
      }) as any,
      { params: { id: entry.id } },
    );
    const untouchedBody = await untouched.json();
    expect(untouchedBody.entry.description).toBe('Second note');
    expect(untouchedBody.entry.durationMinutes).toBe(330);
  });

  it('rejects an entry for another owner\'s client', async () => {
    const otherUser = await prisma.user.create({
      data: { name: 'Foreign Owner', email: `fo-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    const otherClient = await prisma.client.create({
      data: { userId: otherUser.id, name: 'Foreign', email: `foreign-${randomUUID()}@example.com` },
    });

    const res = await createEntry(
      new Request('http://localhost/api/timesheet', {
        method: 'POST',
        body: JSON.stringify(entryPayload({ clientId: otherClient.id })),
      }) as any,
    );
    expect(res.status).toBe(404);
    await prisma.client.delete({ where: { id: otherClient.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it('rejects end-before-start', async () => {
    const res = await createEntry(
      new Request('http://localhost/api/timesheet', {
        method: 'POST',
        body: JSON.stringify(entryPayload({ startedAt: '2026-09-01T16:30:00.000Z', endedAt: '2026-09-01T13:00:00.000Z' })),
      }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('lists entries with client/date filters', async () => {
    await createOpenEntry({ workDate: '2026-09-01' });
    await createOpenEntry({ workDate: '2026-09-05' });

    const res = await listEntries(
      new NextRequest('http://localhost/api/timesheet?dateFrom=2026-09-01&dateTo=2026-09-02'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const dates = body.entries.map((e: { workDate: string }) => e.workDate.slice(0, 10));
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((d: string) => d === '2026-09-01')).toBe(true);
  });

  it('patches only open entries and recomputes duration from the snapshot rate', async () => {
    const entry = await createOpenEntry();
    const res = await patchEntry(
      new Request(`http://localhost/api/timesheet/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ endedAt: '2026-09-01T18:30:00.000Z' }),
      }) as any,
      { params: { id: entry.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.durationMinutes).toBe(330);
    expect(Number(body.entry.hourlyRate)).toBe(50); // snapshot unchanged
  });

  it('rejects patching an invoiced entry', async () => {
    const entry = await createOpenEntry();
    await prisma.timesheetEntry.update({ where: { id: entry.id }, data: { status: 'invoiced' } });
    const res = await patchEntry(
      new Request(`http://localhost/api/timesheet/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ endedAt: '2026-09-01T18:00:00.000Z' }),
      }) as any,
      { params: { id: entry.id } },
    );
    expect(res.status).toBe(409);
  });

  it('deletes only open entries (products cascade)', async () => {
    const entry = await createOpenEntry({ products: [{ name: 'Chips', quantity: 1, unitPrice: 10 }] });
    const res = await deleteEntry(new Request(`http://localhost/api/timesheet/${entry.id}`, { method: 'DELETE' }) as any, {
      params: { id: entry.id },
    });
    expect(res.status).toBe(200);
    expect(await prisma.timesheetEntry.findUnique({ where: { id: entry.id } })).toBeNull();
    expect(await prisma.timesheetProduct.count({ where: { timesheetEntryId: entry.id } })).toBe(0);

    const invoiced = await createOpenEntry();
    await prisma.timesheetEntry.update({ where: { id: invoiced.id }, data: { status: 'invoiced' } });
    const locked = await deleteEntry(new Request(`http://localhost/api/timesheet/${invoiced.id}`, { method: 'DELETE' }) as any, {
      params: { id: invoiced.id },
    });
    expect(locked.status).toBe(409);
  });

  it('generates one invoice from selected open entries with frozen lines, then blocks reuse', async () => {
    const e1 = await createOpenEntry({ workDate: '2026-09-01', products: [{ name: 'Chips', quantity: 2, unitPrice: 25 }] });
    const e2 = await createOpenEntry({ workDate: '2026-09-02' });

    const res = await generateInvoice(
      new Request('http://localhost/api/timesheet/invoice', {
        method: 'POST',
        body: JSON.stringify({ clientId, entryIds: [e1.id, e2.id], taxRate: 0.05, serviceAddress: '123 Oak St' }),
      }) as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invoice.source).toBe('timesheet');
    expect(body.invoice.userId).toBe(userId);
    expect(body.invoice.clientId).toBe(clientId);
    expect(body.invoice.serviceAddress).toBe('123 Oak St');
    expect(body.entryIds.sort()).toEqual([e1.id, e2.id].sort());

    const lines = await prisma.invoiceLineItem.findMany({ where: { invoiceId: body.invoice.id }, orderBy: { sortOrder: 'asc' } });
    // Aggregated: one labor line for both entries (same service + rate), one chips line.
    expect(lines).toHaveLength(2);
    expect(lines[0].description).toContain('Labor');
    // 7h total at 50: e1 (3.5h) + e2 (3.5h).
    expect(Number(lines[0].quantity)).toBe(7);
    expect(Number(lines[0].unitPrice)).toBe(50);
    expect(Number(lines[0].amount)).toBe(350);
    expect(lines[0].notes).toBe('2026-09-01: Test work description\n2026-09-02: Test work description');
    expect(lines[1].description).toBe('Chips');
    expect(Number(lines[1].amount)).toBe(50);
    // Aggregated labor (350) + chips (50) = 400.
    expect(Number(body.invoice.subtotal)).toBe(400);
    expect(Number(body.invoice.taxAmount)).toBe(20);
    expect(Number(body.invoice.total)).toBe(420);

    const entries = await prisma.timesheetEntry.findMany({ where: { id: { in: [e1.id, e2.id] } } });
    expect(entries.every((e) => e.status === 'invoiced' && e.invoiceId === body.invoice.id)).toBe(true);

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendInvoiceEmail).mock.calls[0][0];
    expect(call.invoiceNumber).toBe(body.invoice.number);
    expect(call.items).toHaveLength(2);

    // Reuse is rejected — all selected entries are already invoiced.
    const res2 = await generateInvoice(
      new Request('http://localhost/api/timesheet/invoice', {
        method: 'POST',
        body: JSON.stringify({ clientId, entryIds: [e1.id] }),
      }) as any,
    );
    expect(res2.status).toBe(409);
  });

  it('freezes entry descriptions into invoice line notes (products stay null)', async () => {
    const withDesc = await createOpenEntry({ workDate: '2026-09-03', description: 'Stump grinding and cleanup' });
    const defaultDesc = await createOpenEntry({ workDate: '2026-09-04' });
    const withDescAndProduct = await createOpenEntry({
      workDate: '2026-09-05',
      description: 'Crown reduction',
      products: [{ name: 'Chips', quantity: 1, unitPrice: 40 }],
    });

    const res = await generateInvoice(
      new Request('http://localhost/api/timesheet/invoice', {
        method: 'POST',
        body: JSON.stringify({ clientId, entryIds: [withDesc.id, defaultDesc.id, withDescAndProduct.id] }),
      }) as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    // All three entries share one service + rate, so a single aggregated labor
    // line carries every frozen entry description; the product line stays null.
    const lines = await prisma.invoiceLineItem.findMany({
      where: { invoiceId: body.invoice.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(lines).toHaveLength(2);
    expect(lines[0].description).toContain('Labor');
    expect(lines[0].notes).toBe(
      '2026-09-03: Stump grinding and cleanup\n2026-09-04: Test work description\n2026-09-05: Crown reduction',
    );
    expect(lines[1].description).toBe('Chips');
    expect(lines[1].notes).toBeNull();
    expect(Number(lines[1].amount)).toBe(40);

    // The emailed items carry only the aggregated line title — the per-entry
    // notes stay in the DB (InvoiceLineItem.notes) but are never shown to
    // the client.
    const call = vi.mocked(sendInvoiceEmail).mock.calls.at(-1)![0];
    const laborItems = call.items.filter((i: { title: string }) => i.title.startsWith('Labor'));
    expect(laborItems).toHaveLength(1);
    expect(laborItems[0].description).toBeUndefined();
  });

  it('rejects mixed-client selection', async () => {
    const otherClientUser = await prisma.user.create({
      data: {
        name: 'Other Ts User',
        email: `otsu-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'timesheet', enabled: true } },
      },
    });
    const otherClient = await prisma.client.create({
      data: { userId: otherClientUser.id, name: 'Other Ts Client', email: `otsc-${randomUUID()}@example.com` },
    });
    sessionMock.mockResolvedValue({ user: { id: otherClientUser.id } });
    const res = await createEntry(
      new Request('http://localhost/api/timesheet', {
        method: 'POST',
        body: JSON.stringify({
          clientId: otherClient.id,
          workDate: '2026-09-01',
          startedAt: '2026-09-01T13:00:00.000Z',
          endedAt: '2026-09-01T14:00:00.000Z',
          description: 'Test work description',
        }),
      }) as any,
    );
    const otherEntry = (await res.json()).entry;

    // Back to the main user: selecting the other user's entry id must 409.
    sessionMock.mockResolvedValue({ user: { id: userId } });
    const inv = await generateInvoice(
      new Request('http://localhost/api/timesheet/invoice', {
        method: 'POST',
        body: JSON.stringify({ clientId, entryIds: [otherEntry.id] }),
      }) as any,
    );
    expect(inv.status).toBe(409);

    await prisma.timesheetProduct.deleteMany({ where: { timesheetEntry: { userId: otherClientUser.id } } });
    await prisma.timesheetEntry.deleteMany({ where: { userId: otherClientUser.id } });
    await prisma.client.delete({ where: { id: otherClient.id } });
    await prisma.user.delete({ where: { id: otherClientUser.id } });
  });

  it('two concurrent generation requests: only one succeeds', async () => {
    const e1 = await createOpenEntry({ workDate: '2026-09-10' });
    const e2 = await createOpenEntry({ workDate: '2026-09-11' });
    const payload = {
      clientId,
      entryIds: [e1.id, e2.id],
      taxRate: 0.05,
    };

    const [resA, resB] = await Promise.all([
      generateInvoice(
        new Request('http://localhost/api/timesheet/invoice', {
          method: 'POST',
          body: JSON.stringify(payload),
        }) as any,
      ),
      generateInvoice(
        new Request('http://localhost/api/timesheet/invoice', {
          method: 'POST',
          body: JSON.stringify(payload),
        }) as any,
      ),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const entries = await prisma.timesheetEntry.findMany({ where: { id: { in: [e1.id, e2.id] } } });
    expect(entries.every((e) => e.status === 'invoiced')).toBe(true);
    const invoiceIds = new Set(entries.map((e) => e.invoiceId));
    expect(invoiceIds.size).toBe(1);
  });
});
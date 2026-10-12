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
import { NextRequest } from 'next/server';
import { GET as getSummary } from '@/app/api/financial/route';
import { GET as getPdf } from '@/app/api/financial/pdf/route';
import { prisma } from '@/lib/db';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

function req(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe('/api/financial', () => {
  let userId: string;
  let otherUserId: string;
  let clientId: string;
  let otherClientId: string;
  const invoiceIds: string[] = [];
  const quoteIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Financial Test',
        email: `financial-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'invoices', enabled: true } },
      },
    });
    userId = user.id;
    const other = await prisma.user.create({
      data: {
        name: 'Financial Other',
        email: `financial-other-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'invoices', enabled: true } },
      },
    });
    otherUserId = other.id;

    clientId = (await prisma.client.create({ data: { userId, name: 'Fin Client' } })).id;
    otherClientId = (await prisma.client.create({ data: { userId: otherUserId, name: 'Other Fin Client' } })).id;

    const make = async (
      owner: string,
      client: string,
      createdAt: string,
      subtotal: number,
      taxAmount: number,
      paymentStatus: 'pending' | 'paid',
      source: 'quote' | 'timesheet',
    ) => {
      const inv = await prisma.invoice.create({
        data: {
          source,
          userId: owner,
          clientId: client,
          subtotal,
          taxRate: 0.05,
          taxAmount,
          total: subtotal + taxAmount,
          paymentStatus,
          createdAt: new Date(createdAt),
        },
      });
      invoiceIds.push(inv.id);
    };

    // Far-future dates so no real data can fall in these periods.
    await make(userId, clientId, '2031-03-10T15:00:00.000Z', 1000, 50, 'paid', 'quote');
    await make(userId, clientId, '2031-03-20T15:00:00.000Z', 400, 20, 'pending', 'timesheet');
    await make(userId, clientId, '2031-04-02T15:00:00.000Z', 200, 10, 'paid', 'timesheet');
    await make(otherUserId, otherClientId, '2031-03-11T15:00:00.000Z', 9999, 500, 'paid', 'timesheet');

    const scheduled = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId,
        createdById: userId,
        status: 'scheduled',
        subtotal: 300,
        taxRate: 0.05,
        taxAmount: 15,
        total: 315,
      },
    });
    quoteIds.push(scheduled.id);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, otherClientId] } } });
    await prisma.companyProfile.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    cookieGetMock.mockReset();
    cookieGetMock.mockReturnValue(undefined);
    sessionMock.mockResolvedValue({ user: { id: userId } });
  });

  it('monthly summary splits net, GST and gross, paid vs outstanding', async () => {
    const res = await getSummary(req('/api/financial?preset=monthly&date=2031-03-15'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs.completed).toBe(2);
    expect(body.jobs.completedQuotes).toBe(1);
    expect(body.jobs.timesheetInvoices).toBe(1);
    expect(body.jobs.paid).toBe(1);
    expect(body.jobs.unpaid).toBe(1);
    expect(body.jobs.scheduledOpen).toBe(1);
    expect(body.invoiced).toEqual({ net: 1400, gst: 70, gross: 1470 });
    expect(body.received).toEqual({ net: 1000, gst: 50, gross: 1050 });
    expect(body.outstanding).toEqual({ net: 400, gst: 20, gross: 420 });
    expect(body.scheduledValue).toEqual({ net: 300, gst: 15, gross: 315 });
    expect(body.invoices).toHaveLength(2);
  });

  it('excludes other users and other periods', async () => {
    const day = await (await getSummary(req('/api/financial?preset=daily&date=2031-03-11'))).json();
    expect(day.jobs.completed).toBe(0);
    const year = await (await getSummary(req('/api/financial?preset=yearly&date=2031-06-01'))).json();
    expect(year.jobs.completed).toBe(3);
    expect(year.invoiced.gross).toBe(1680);
  });

  it('custom range is inclusive of both ends', async () => {
    const res = await getSummary(req('/api/financial?preset=custom&from=2031-03-20&to=2031-04-02'));
    const body = await res.json();
    expect(body.jobs.completed).toBe(2);
  });

  it('rejects invalid periods with 400', async () => {
    const res = await getSummary(req('/api/financial?preset=custom&from=2031-03-20'));
    expect(res.status).toBe(400);
  });

  it('401 when unauthenticated, 403 when feature disabled', async () => {
    sessionMock.mockResolvedValue(null);
    expect((await getSummary(req('/api/financial?preset=yearly&date=2031-01-01'))).status).toBe(401);

    const noFlag = await prisma.user.create({
      data: { name: 'No Flag', email: `fin-noflag-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    sessionMock.mockResolvedValue({ user: { id: noFlag.id } });
    expect((await getSummary(req('/api/financial?preset=yearly&date=2031-01-01'))).status).toBe(403);
    expect((await getPdf(req('/api/financial/pdf?preset=yearly&date=2031-01-01'))).status).toBe(403);
    await prisma.companyProfile.deleteMany({ where: { userId: noFlag.id } });
    await prisma.user.delete({ where: { id: noFlag.id } });
  });

  it('PDF returns a well-formed PDF document', async () => {
    const res = await getPdf(req('/api/financial/pdf?preset=monthly&date=2031-03-15'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('financial-report-monthly-');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });
});

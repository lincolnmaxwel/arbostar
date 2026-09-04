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
vi.mock('@/lib/email', () => ({ sendPaymentReceivedEmail: vi.fn().mockResolvedValue(undefined) }));

import { getServerSession } from 'next-auth';
import { GET as listInvoices } from '@/app/api/invoices/route';
import { GET as getInvoice, PATCH as patchInvoice, DELETE as deleteInvoice } from '@/app/api/invoices/[id]/route';
import { prisma } from '@/lib/db';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

describe('/api/invoices', () => {
  let userId: string;
  let otherUserId: string;
  let quoteId: string;
  let clientId: string;
  let invoiceId: string;
  let timesheetInvoiceId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Invoices Test',
        email: `invoicesapi-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'invoices', enabled: true } },
      },
    });
    userId = user.id;
    const other = await prisma.user.create({
      data: {
        name: 'Other Invoices',
        email: `invoicesapi-other-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: { feature: 'invoices', enabled: true } },
      },
    });
    otherUserId = other.id;

    const client = await prisma.client.create({
      data: { userId, name: 'Invoice Client', email: `invclient-${randomUUID()}@example.com` },
    });
    clientId = client.id;
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        status: 'completed',
        subtotal: 500,
        taxRate: 0.05,
        taxAmount: 25,
        total: 525,
        items: { create: [{ localItemId: randomUUID(), title: 'Tree removal', price: 500, sortOrder: 0 }] },
      },
    });
    quoteId = quote.id;
    const invoice = await prisma.invoice.create({
      data: {
        source: 'quote',
        quoteId: quote.id,
        userId,
        clientId: client.id,
        serviceAddress: '123 Oak St',
        subtotal: 500,
        taxRate: 0.05,
        taxAmount: 25,
        total: 525,
        sentAt: new Date(),
      },
    });
    invoiceId = invoice.id;

    const timesheetInvoice = await prisma.invoice.create({
      data: {
        source: 'timesheet',
        userId,
        clientId: client.id,
        serviceAddress: '456 Elm St',
        subtotal: 800,
        taxRate: 0.05,
        taxAmount: 40,
        total: 840,
        lineItems: {
          create: [
            { description: 'Labor — hedge trimming', quantity: 8, unitPrice: 100, amount: 800, sortOrder: 0 },
          ],
        },
      },
    });
    timesheetInvoiceId = timesheetInvoice.id;
  });

  afterAll(async () => {
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: timesheetInvoiceId } });
    await prisma.invoice.deleteMany({ where: { id: { in: [invoiceId, timesheetInvoiceId] } } });
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.client.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
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

  it('GET list returns both invoice sources with client info', async () => {
    const res = await listInvoices();
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.invoices.find((inv: { id: string }) => inv.id === invoiceId);
    expect(found).toBeDefined();
    expect(found.source).toBe('quote');
    expect(found.client.name).toBe('Invoice Client');
    expect(Number(found.total)).toBe(525);

    const ts = body.invoices.find((inv: { id: string }) => inv.id === timesheetInvoiceId);
    expect(ts).toBeDefined();
    expect(ts.source).toBe('timesheet');
    expect(ts.quote).toBeNull();
    expect(ts.lineItems).toHaveLength(1);
  });

  it('GET list returns 401 when unauthenticated', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await listInvoices();
    expect(res.status).toBe(401);
  });

  it('GET list returns 403 when the invoices feature is disabled', async () => {
    const noFlagUser = await prisma.user.create({
      data: { name: 'No Flag', email: `noflag-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    sessionMock.mockResolvedValue({ user: { id: noFlagUser.id } });
    const res = await listInvoices();
    expect(res.status).toBe(403);
    await prisma.user.delete({ where: { id: noFlagUser.id } });
  });

  it('GET detail returns quote invoice with quote items and client', async () => {
    const res = await getInvoice(new Request(`http://localhost/api/invoices/${invoiceId}`) as any, { params: { id: invoiceId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice.source).toBe('quote');
    expect(body.invoice.quote.items).toHaveLength(1);
    expect(body.invoice.quote.items[0].title).toBe('Tree removal');
    expect(body.invoice.client.name).toBe('Invoice Client');
  });

  it('GET detail renders a timesheet invoice with nullable quote and line items', async () => {
    const res = await getInvoice(new Request(`http://localhost/api/invoices/${timesheetInvoiceId}`) as any, {
      params: { id: timesheetInvoiceId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice.source).toBe('timesheet');
    expect(body.invoice.quote).toBeNull();
    expect(body.invoice.lineItems).toHaveLength(1);
    expect(Number(body.invoice.lineItems[0].amount)).toBe(800);
  });

  it('GET detail returns 404 for an unknown invoice', async () => {
    const res = await getInvoice(new Request('http://localhost/api/invoices/does-not-exist') as any, { params: { id: 'does-not-exist' } });
    expect(res.status).toBe(404);
  });

  it('GET detail returns 404 for another owner\'s invoice', async () => {
    sessionMock.mockResolvedValue({ user: { id: otherUserId } });
    const res = await getInvoice(new Request(`http://localhost/api/invoices/${invoiceId}`) as any, { params: { id: invoiceId } });
    expect(res.status).toBe(404);
  });

  it('is created with pending payment status', async () => {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(invoice?.paymentStatus).toBe('pending');
    expect(invoice?.paidAt).toBeNull();
  });

  it('PATCH marks an invoice as paid and sets paidAt', async () => {
    const res = await patchInvoice(
      new Request(`http://localhost/api/invoices/${timesheetInvoiceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus: 'paid' }),
      }) as any,
      { params: { id: timesheetInvoiceId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice.paymentStatus).toBe('paid');
    expect(body.invoice.paidAt).not.toBeNull();
  });

  it('PATCH refuses to re-mark an already-paid invoice (one-way transition)', async () => {
    const res = await patchInvoice(
      new Request(`http://localhost/api/invoices/${timesheetInvoiceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus: 'paid' }),
      }) as any,
      { params: { id: timesheetInvoiceId } },
    );
    expect(res.status).toBe(409);
  });

  it('PATCH rejects "pending" as a target status — there is no path back once paid', async () => {
    const res = await patchInvoice(
      new Request(`http://localhost/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus: 'pending' }),
      }) as any,
      { params: { id: invoiceId } },
    );
    expect(res.status).toBe(400);
  });

  it('PATCH rejects an invalid paymentStatus', async () => {
    const res = await patchInvoice(
      new Request(`http://localhost/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus: 'bogus' }),
      }) as any,
      { params: { id: invoiceId } },
    );
    expect(res.status).toBe(400);
  });

  it('PATCH returns 404 for an unknown invoice', async () => {
    const res = await patchInvoice(
      new Request('http://localhost/api/invoices/does-not-exist', {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus: 'paid' }),
      }) as any,
      { params: { id: 'does-not-exist' } },
    );
    expect(res.status).toBe(404);
  });

  it('PATCH returns 401 when unauthenticated', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await patchInvoice(
      new Request('http://localhost/api/invoices/anything', {
        method: 'PATCH',
        body: JSON.stringify({ paymentStatus: 'paid' }),
      }) as any,
      { params: { id: 'anything' } },
    );
    expect(res.status).toBe(401);
  });

  it('DELETE removes a quote invoice and unblocks deleting its quote afterward', async () => {
    const client = await prisma.client.create({
      data: { userId, name: 'Delete Invoice Client', email: `delinv-${randomUUID()}@example.com` },
    });
    const quote = await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: client.id, createdById: userId, status: 'completed' },
    });
    const invoice = await prisma.invoice.create({
      data: { source: 'quote', quoteId: quote.id, userId, clientId: client.id, subtotal: 100, taxRate: 0.05, taxAmount: 5, total: 105 },
    });

    const res = await deleteInvoice(new Request(`http://localhost/api/invoices/${invoice.id}`, { method: 'DELETE' }) as any, {
      params: { id: invoice.id },
    });
    expect(res.status).toBe(200);
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();

    // The quote itself is untouched by deleting its invoice.
    expect(await prisma.quote.findUnique({ where: { id: quote.id } })).not.toBeNull();

    await prisma.quote.delete({ where: { id: quote.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });

  it('DELETE rejects a timesheet invoice with 409 and an English message', async () => {
    const res = await deleteInvoice(new Request(`http://localhost/api/invoices/${timesheetInvoiceId}`, { method: 'DELETE' }) as any, {
      params: { id: timesheetInvoiceId },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('timesheet-invoice-locked');
    expect(body.message).toBe('Timesheet invoices cannot be deleted.');
    expect(await prisma.invoice.findUnique({ where: { id: timesheetInvoiceId } })).not.toBeNull();
  });

  it('DELETE returns 404 for an unknown invoice', async () => {
    const res = await deleteInvoice(new Request('http://localhost/api/invoices/does-not-exist', { method: 'DELETE' }) as any, {
      params: { id: 'does-not-exist' },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE returns 404 for another owner\'s invoice', async () => {
    sessionMock.mockResolvedValue({ user: { id: otherUserId } });
    const res = await deleteInvoice(new Request(`http://localhost/api/invoices/${invoiceId}`, { method: 'DELETE' }) as any, {
      params: { id: invoiceId },
    });
    expect(res.status).toBe(404);
    expect(await prisma.invoice.findUnique({ where: { id: invoiceId } })).not.toBeNull();
  });

  it('DELETE returns 401 when unauthenticated', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await deleteInvoice(new Request('http://localhost/api/invoices/anything', { method: 'DELETE' }) as any, {
      params: { id: 'anything' },
    });
    expect(res.status).toBe(401);
  });
});
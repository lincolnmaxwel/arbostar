import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.includes('login.microsoftonline.com')) {
    return {
      ok: true,
      json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
    } as Response;
  }
  return {
    ok: true,
    text: async () => '',
  } as Response;
});

vi.stubGlobal('fetch', fetchMock);

import {
  sendQuoteApprovalEmail,
  sendBookingProposalEmail,
  sendQuoteDecisionNotificationEmail,
  sendBookingDecisionNotificationEmail,
  sendInvoiceEmail,
} from '@/lib/email';

function lastSendMailCall() {
  const call = fetchMock.mock.calls.find(([url]) => (url as string).includes('graph.microsoft.com'));
  if (!call) throw new Error('sendMail was never called');
  const [url, init] = call as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string).message as Record<string, unknown> };
}

beforeEach(() => {
  fetchMock.mockClear();
  process.env.AZURE_TENANT_ID = 'test-tenant';
  process.env.AZURE_CLIENT_ID = 'test-client';
  process.env.AZURE_CLIENT_SECRET = 'test-secret';
  process.env.AZURE_SENDER_EMAIL = 'noreply@paschoini.adv.br';
});

describe('sendQuoteApprovalEmail', () => {
  it('sends an email with the client name, portal link, itemized proposal, and totals', async () => {
    await sendQuoteApprovalEmail({
      to: 'nelson@example.com',
      clientName: 'Nelson Costa',
      portalUrl: 'http://localhost:3000/portal/abc-123',
      items: [
        { title: 'Hedges', description: 'Trim the top', price: 1250 },
        { title: 'Hedges', price: 500 },
      ],
      subtotal: 1750,
      taxRate: 0.05,
      taxAmount: 87.5,
      total: 1837.5,
    });

    const { url, body } = lastSendMailCall();
    expect(url).toBe('https://graph.microsoft.com/v1.0/users/noreply@paschoini.adv.br/sendMail');
    expect((body.toRecipients as { emailAddress: { address: string } }[])[0].emailAddress.address).toBe('nelson@example.com');
    const html = (body.body as { content: string }).content;
    expect(html).toContain('Nelson Costa');
    expect(html).toContain('http://localhost:3000/portal/abc-123');
    expect(html).toContain('Hedges');
    expect(html).toContain('Trim the top');
    expect(html).toContain('$1,837.50');
  });

  it('includes the service address when provided', async () => {
    await sendQuoteApprovalEmail({
      to: 'nelson@example.com',
      clientName: 'Nelson Costa',
      portalUrl: 'http://localhost:3000/portal/abc-123',
      items: [{ title: 'Hedges', price: 500 }],
      subtotal: 500,
      taxRate: 0.05,
      taxAmount: 25,
      total: 525,
      serviceAddress: '123 Oak St, Springfield',
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).toContain('123 Oak St, Springfield');
  });

  it('escapes HTML in item titles/descriptions and client name', async () => {
    await sendQuoteApprovalEmail({
      to: 'x@example.com',
      clientName: '<b>Nelson</b>',
      portalUrl: 'http://localhost:3000/portal/abc-123',
      items: [{ title: '<script>alert(1)</script>', description: null, price: 10 }],
      subtotal: 10,
      taxRate: 0,
      taxAmount: 0,
      total: 10,
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>Nelson</b>');
  });
});

describe('sendBookingProposalEmail', () => {
  it('sends an email with the client name, portal link, round number, and date options', async () => {
    await sendBookingProposalEmail({
      to: 'maria@example.com',
      clientName: 'Maria Silva',
      portalUrl: 'http://localhost:3000/portal/token-xyz',
      roundNumber: 1,
      options: [
        { date: '2026-07-15', window: 'morning' },
        { date: '2026-07-17', window: 'fullday' },
      ],
    });

    const { body } = lastSendMailCall();
    expect((body.toRecipients as { emailAddress: { address: string } }[])[0].emailAddress.address).toBe('maria@example.com');
    expect(body.subject).toBe('Scheduling options for your approved estimate');
    const html = (body.body as { content: string }).content;
    expect(html).toContain('Maria Silva');
    expect(html).toContain('http://localhost:3000/portal/token-xyz');
    expect(html).toContain('round 1');
    // Date formatting: 'Tuesday, July 15, 2026' (en-US locale default for toLocaleDateString)
    expect(html).toMatch(/July 15, 2026/);
    expect(html).toMatch(/July 17, 2026/);
    expect(html).toContain('Morning');
    expect(html).toContain('Full day');
  });

  it('escapes HTML in client name and does not repeat the line-item breakdown', async () => {
    await sendBookingProposalEmail({
      to: 'x@example.com',
      clientName: '<b>Maria</b>',
      portalUrl: 'http://localhost:3000/portal/t',
      roundNumber: 2,
      options: [{ date: '2026-07-15', window: 'afternoon' }],
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).not.toContain('<b>Maria</b>');
    expect(html).toContain('&lt;b&gt;Maria&lt;/b&gt;');
    // No price table — booking email never lists line items.
    expect(html).not.toMatch(/\$\d+\.\d{2}/);
  });
});

describe('sendQuoteDecisionNotificationEmail', () => {
  it('notifies staff of an approval with the client name, quote number, and link', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Nelson Costa',
      quoteNumber: 42,
      decision: 'approved',
      quoteUrl: 'http://localhost:3000/quotes/draft-123',
    });

    const { body } = lastSendMailCall();
    expect((body.toRecipients as { emailAddress: { address: string } }[])[0].emailAddress.address).toBe('staff@example.com');
    expect(body.subject).toContain('#42');
    expect(body.subject).toContain('approved');
    const html = (body.body as { content: string }).content;
    expect(html).toContain('Nelson Costa');
    expect(html).toContain('approved');
    expect(html).toContain('http://localhost:3000/quotes/draft-123');
  });

  it('notifies staff of a decline', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Nelson Costa',
      quoteNumber: 7,
      decision: 'declined',
      quoteUrl: 'http://localhost:3000/quotes/draft-456',
    });

    const { body } = lastSendMailCall();
    expect(body.subject).toContain('declined');
    const html = (body.body as { content: string }).content;
    expect(html).toContain('declined');
  });

  it('escapes HTML in the client name', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: '<b>Nelson</b>',
      quoteNumber: 1,
      decision: 'approved',
      quoteUrl: 'http://localhost:3000/quotes/draft-789',
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).not.toContain('<b>Nelson</b>');
    expect(html).toContain('&lt;b&gt;Nelson&lt;/b&gt;');
  });

  it('includes the client phone and service address when provided', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Nelson Costa',
      clientPhone: '(555) 123-4567',
      serviceAddress: '123 Oak St, Springfield',
      quoteNumber: 5,
      decision: 'approved',
      quoteUrl: 'http://localhost:3000/quotes/draft-5',
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).toContain('(555) 123-4567');
    expect(html).toContain('123 Oak St, Springfield');
  });

  it('omits the contact block entirely when phone and address are absent', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Nelson Costa',
      quoteNumber: 6,
      decision: 'approved',
      quoteUrl: 'http://localhost:3000/quotes/draft-6',
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).not.toContain('Phone:');
  });
});

describe('sendBookingDecisionNotificationEmail', () => {
  it('notifies staff of a confirmed date/window', async () => {
    await sendBookingDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Maria Silva',
      quoteNumber: 10,
      quoteUrl: 'http://localhost:3000/quotes/draft-abc',
      decision: 'confirmed',
      scheduledDate: '2026-07-15',
      scheduledWindow: 'morning',
    });

    const { body } = lastSendMailCall();
    expect(body.subject).toContain('confirmed');
    const html = (body.body as { content: string }).content;
    expect(html).toContain('Maria Silva');
    expect(html).toMatch(/July 15, 2026/);
    expect(html).toContain('Morning');
  });

  it('notifies staff of a rejection with the client-provided reason', async () => {
    await sendBookingDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Maria Silva',
      quoteNumber: 11,
      quoteUrl: 'http://localhost:3000/quotes/draft-def',
      decision: 'rejected',
      rejectionReason: 'None of these days work.',
    });

    const { body } = lastSendMailCall();
    expect(body.subject).toContain('rejected');
    const html = (body.body as { content: string }).content;
    expect(html).toContain('None of these days work.');
  });
});

describe('sendInvoiceEmail', () => {
  it('sends the invoice number, itemized breakdown, and totals', async () => {
    await sendInvoiceEmail({
      to: 'nelson@example.com',
      clientName: 'Nelson Costa',
      invoiceNumber: 7,
      companyName: 'Tip Top Tree Service Ltd',
      items: [{ title: 'Tree removal', price: 500 }],
      subtotal: 500,
      taxRate: 0.05,
      taxAmount: 25,
      total: 525,
    });

    const { body } = lastSendMailCall();
    expect((body.toRecipients as { emailAddress: { address: string } }[])[0].emailAddress.address).toBe('nelson@example.com');
    expect(body.subject).toBe('Invoice #7');
    const html = (body.body as { content: string }).content;
    expect(html).toContain('Nelson Costa');
    expect(html).toContain('#7');
    expect(html).toContain('Tree removal');
    expect(html).toContain('$525.00');
    expect(html).toContain('Tip Top Tree Service Ltd');
  });

  it('escapes HTML in the client and company name', async () => {
    await sendInvoiceEmail({
      to: 'x@example.com',
      clientName: '<b>Nelson</b>',
      invoiceNumber: 1,
      companyName: '<script>alert(1)</script>',
      items: [{ title: 'Hedges', price: 10 }],
      subtotal: 10,
      taxRate: 0,
      taxAmount: 0,
      total: 10,
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).not.toContain('<b>Nelson</b>');
    expect(html).toContain('&lt;b&gt;Nelson&lt;/b&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('omits company branding gracefully when no company name is set', async () => {
    await sendInvoiceEmail({
      to: 'x@example.com',
      clientName: 'Nelson Costa',
      invoiceNumber: 2,
      items: [{ title: 'Hedges', price: 10 }],
      subtotal: 10,
      taxRate: 0,
      taxAmount: 0,
      total: 10,
    });

    const { body } = lastSendMailCall();
    const html = (body.body as { content: string }).content;
    expect(html).toContain('Thank you for your business with us!');
  });

  it('attaches the PDF when pdfBuffer is provided', async () => {
    const pdfBuffer = Buffer.from('%PDF-fake-content');
    await sendInvoiceEmail({
      to: 'nelson@example.com',
      clientName: 'Nelson Costa',
      invoiceNumber: 3,
      items: [{ title: 'Hedges', price: 10 }],
      subtotal: 10,
      taxRate: 0,
      taxAmount: 0,
      total: 10,
      pdfBuffer,
    });

    const { body } = lastSendMailCall();
    const attachments = body.attachments as { name: string; contentType: string; contentBytes: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe('invoice-3.pdf');
    expect(attachments[0].contentType).toBe('application/pdf');
    expect(attachments[0].contentBytes).toBe(pdfBuffer.toString('base64'));
  });

  it('omits attachments entirely when no pdfBuffer is provided', async () => {
    await sendInvoiceEmail({
      to: 'nelson@example.com',
      clientName: 'Nelson Costa',
      invoiceNumber: 4,
      items: [{ title: 'Hedges', price: 10 }],
      subtotal: 10,
      taxRate: 0,
      taxAmount: 0,
      total: 10,
    });

    const { body } = lastSendMailCall();
    expect(body.attachments).toBeUndefined();
  });
});

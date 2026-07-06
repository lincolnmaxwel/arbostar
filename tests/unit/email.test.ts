import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'abc' });
const createTransportMock = vi.fn((_options: unknown) => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: unknown) => createTransportMock(options),
    getTestMessageUrl: () => null,
  },
}));

import {
  sendQuoteApprovalEmail,
  sendBookingProposalEmail,
  sendQuoteDecisionNotificationEmail,
  sendBookingDecisionNotificationEmail,
} from '@/lib/email';

describe('sendQuoteApprovalEmail', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    process.env.SMTP_FROM = 'Arbostar Quotes <test@example.com>';
  });

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

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('nelson@example.com');
    expect(call.from).toBe('Arbostar Quotes <test@example.com>');
    expect(call.text).toContain('Nelson Costa');
    expect(call.text).toContain('http://localhost:3000/portal/abc-123');
    expect(call.text).toContain('Hedges');
    expect(call.text).toContain('Trim the top');
    expect(call.text).toContain('$1,250.00');
    expect(call.text).toContain('$1,837.50');
    expect(call.html).toContain('http://localhost:3000/portal/abc-123');
    expect(call.html).toContain('Hedges');
    expect(call.html).toContain('Trim the top');
    expect(call.html).toContain('$1,837.50');
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

    const call = sendMailMock.mock.calls[0][0];
    expect(call.html).not.toContain('<script>alert(1)</script>');
    expect(call.html).toContain('&lt;script&gt;');
    expect(call.html).not.toContain('<b>Nelson</b>');
  });
});

describe('sendBookingProposalEmail', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    process.env.SMTP_FROM = 'Arbostar Quotes <test@example.com>';
  });

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

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('maria@example.com');
    expect(call.from).toBe('Arbostar Quotes <test@example.com>');
    expect(call.subject).toBe('Scheduling options for your approved estimate');
    expect(call.text).toContain('Maria Silva');
    expect(call.text).toContain('http://localhost:3000/portal/token-xyz');
    expect(call.text).toContain('Round 1');
    // Date formatting: 'Tuesday, July 15, 2026' (en-US locale default for toLocaleDateString)
    expect(call.text).toMatch(/July 15, 2026/);
    expect(call.text).toMatch(/July 17, 2026/);
    expect(call.text).toContain('Morning');
    expect(call.text).toContain('Full day');
    expect(call.html).toContain('http://localhost:3000/portal/token-xyz');
    expect(call.html).toContain('Morning');
    expect(call.html).toContain('Full day');
  });

  it('escapes HTML in client name and does not repeat the line-item breakdown', async () => {
    await sendBookingProposalEmail({
      to: 'x@example.com',
      clientName: '<b>Maria</b>',
      portalUrl: 'http://localhost:3000/portal/t',
      roundNumber: 2,
      options: [{ date: '2026-07-15', window: 'afternoon' }],
    });

    const call = sendMailMock.mock.calls[0][0];
    expect(call.html).not.toContain('<b>Maria</b>');
    expect(call.html).toContain('&lt;b&gt;Maria&lt;/b&gt;');
    // No price table — booking email never lists line items.
    expect(call.html).not.toMatch(/\$\d+\.\d{2}/);
  });
});

describe('sendQuoteDecisionNotificationEmail', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    process.env.SMTP_FROM = 'Arbostar Quotes <test@example.com>';
  });

  it('notifies staff of an approval with the client name, quote number, and link', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Nelson Costa',
      quoteNumber: 42,
      decision: 'approved',
      quoteUrl: 'http://localhost:3000/quotes/draft-123',
    });

    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('staff@example.com');
    expect(call.subject).toContain('#42');
    expect(call.subject).toContain('approved');
    expect(call.text).toContain('Nelson Costa');
    expect(call.text).toContain('approved');
    expect(call.text).toContain('http://localhost:3000/quotes/draft-123');
  });

  it('notifies staff of a decline', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: 'Nelson Costa',
      quoteNumber: 7,
      decision: 'declined',
      quoteUrl: 'http://localhost:3000/quotes/draft-456',
    });

    const call = sendMailMock.mock.calls[0][0];
    expect(call.subject).toContain('declined');
    expect(call.text).toContain('declined');
  });

  it('escapes HTML in the client name', async () => {
    await sendQuoteDecisionNotificationEmail({
      to: 'staff@example.com',
      clientName: '<b>Nelson</b>',
      quoteNumber: 1,
      decision: 'approved',
      quoteUrl: 'http://localhost:3000/quotes/draft-789',
    });

    const call = sendMailMock.mock.calls[0][0];
    expect(call.html).not.toContain('<b>Nelson</b>');
    expect(call.html).toContain('&lt;b&gt;Nelson&lt;/b&gt;');
  });
});

describe('sendBookingDecisionNotificationEmail', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    process.env.SMTP_FROM = 'Arbostar Quotes <test@example.com>';
  });

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

    const call = sendMailMock.mock.calls[0][0];
    expect(call.subject).toContain('confirmed');
    expect(call.text).toContain('Maria Silva');
    expect(call.text).toMatch(/July 15, 2026/);
    expect(call.text).toContain('Morning');
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

    const call = sendMailMock.mock.calls[0][0];
    expect(call.subject).toContain('rejected');
    expect(call.text).toContain('None of these days work.');
  });
});

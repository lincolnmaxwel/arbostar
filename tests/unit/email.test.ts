import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'abc' });
const createTransportMock = vi.fn((_options: unknown) => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: unknown) => createTransportMock(options),
    getTestMessageUrl: () => null,
  },
}));

import { sendQuoteApprovalEmail } from '@/lib/email';

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
    expect(call.text).toContain('$1250.00');
    expect(call.text).toContain('$1837.50');
    expect(call.html).toContain('http://localhost:3000/portal/abc-123');
    expect(call.html).toContain('Hedges');
    expect(call.html).toContain('Trim the top');
    expect(call.html).toContain('$1837.50');
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

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

  it('sends an email with the client name, portal link, and formatted total', async () => {
    await sendQuoteApprovalEmail({
      to: 'nelson@example.com',
      clientName: 'Nelson Costa',
      portalUrl: 'http://localhost:3000/portal/abc-123',
      total: 1837.5,
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('nelson@example.com');
    expect(call.from).toBe('Arbostar Quotes <test@example.com>');
    expect(call.text).toContain('Nelson Costa');
    expect(call.text).toContain('http://localhost:3000/portal/abc-123');
    expect(call.text).toContain('$1837.50');
    expect(call.html).toContain('http://localhost:3000/portal/abc-123');
  });
});

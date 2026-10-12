import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendGraphMail } from '@/lib/graphMail';
import { buildFromHeader } from '@/lib/resendMail';
import { mailSenderFromProfile } from '@/lib/mailSender';

describe('mail provider selection', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('MAIL_FROM_ADDRESS', 'noreply@myjobbs.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends through Resend with from name, reply-to and attachment when a key is set', async () => {
    await sendGraphMail({
      to: 'client@example.com',
      subject: 'Invoice #1',
      html: '<p>Hi</p>',
      fromName: 'Tip Top Trees',
      replyTo: 'owner@example.com',
      attachments: [{ filename: 'invoice-1.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('Tip Top Trees <noreply@myjobbs.com>');
    expect(body.to).toEqual(['client@example.com']);
    expect(body.reply_to).toBe('owner@example.com');
    expect(body.attachments[0]).toEqual({ filename: 'invoice-1.pdf', content: Buffer.from('pdf').toString('base64') });
  });

  it('throws when Resend rejects the message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => 'domain not verified' });
    await expect(sendGraphMail({ to: 'a@b.com', subject: 's', html: 'h' })).rejects.toThrow(/Resend send failed: 422/);
  });

  it('falls back to Microsoft Graph when no Resend key is set', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('AZURE_TENANT_ID', 't');
    vi.stubEnv('AZURE_SENDER_EMAIL', 'me@corp.com');
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com')
        ? { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
        : { ok: true, text: async () => '' },
    );
    await sendGraphMail({ to: 'a@b.com', subject: 's', html: 'h', replyTo: 'owner@example.com' });
    const graphCall = fetchMock.mock.calls.find(([u]) => String(u).includes('graph.microsoft.com'));
    expect(graphCall).toBeDefined();
    const body = JSON.parse(graphCall![1].body);
    expect(body.message.replyTo).toEqual([{ emailAddress: { address: 'owner@example.com' } }]);
  });
});

describe('buildFromHeader', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to MyJobbs <noreply@myjobbs.com>', () => {
    vi.stubEnv('MAIL_FROM_ADDRESS', '');
    vi.stubEnv('MAIL_FROM_NAME', '');
    expect(buildFromHeader()).toBe('MyJobbs <noreply@myjobbs.com>');
  });

  it('strips characters that could break the header', () => {
    vi.stubEnv('MAIL_FROM_ADDRESS', 'noreply@myjobbs.com');
    expect(buildFromHeader('Evil" <x@y.com>\r\nBcc: a@b.com')).toBe('Evil x@y.com Bcc: a@b.com <noreply@myjobbs.com>');
  });
});

describe('mailSenderFromProfile', () => {
  it('uses company name and a valid email as reply-to', () => {
    expect(mailSenderFromProfile({ name: ' Tip Top ', email: 'a@b.com' })).toEqual({ fromName: 'Tip Top', replyTo: 'a@b.com' });
  });
  it('drops blank names and invalid emails', () => {
    expect(mailSenderFromProfile({ name: '  ', email: 'not-an-email' })).toEqual({ fromName: undefined, replyTo: undefined });
    expect(mailSenderFromProfile({ name: null, email: null })).toEqual({ fromName: undefined, replyTo: undefined });
  });
});

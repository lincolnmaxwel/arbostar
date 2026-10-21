import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sendGraphMail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/graphMail', () => ({ sendGraphMail }));

import { POST } from '@/app/api/contact/route';

let ipCounter = 0;
function post(body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return POST(
    new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  );
}

const valid = { name: 'Ana Client', email: 'ana@example.com', phone: '555-1234', message: 'I would like a demo please.' };

describe('POST /api/contact', () => {
  beforeEach(() => {
    sendGraphMail.mockReset();
    sendGraphMail.mockResolvedValue(undefined);
  });

  it('emails the owner with the visitor as reply-to', async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(sendGraphMail).toHaveBeenCalledTimes(1);
    const mail = sendGraphMail.mock.calls[0][0];
    expect(mail.to).toBe('lincolnmaxwel@hotmail.com');
    expect(mail.replyTo).toBe('ana@example.com');
    expect(mail.html).toContain('I would like a demo please.');
  });

  it('escapes HTML in the message', async () => {
    await post({ ...valid, message: '<script>alert(1)</script> hello there' });
    expect(sendGraphMail.mock.calls[0][0].html).not.toContain('<script>alert(1)</script>');
  });

  it('rejects bad input without sending', async () => {
    expect((await post({ ...valid, name: 'A' })).status).toBe(400);
    expect((await post({ ...valid, email: 'nope' })).status).toBe(400);
    expect((await post({ ...valid, message: 'short' })).status).toBe(400);
    expect(sendGraphMail).not.toHaveBeenCalled();
  });

  it('silently ignores the honeypot', async () => {
    const res = await post({ ...valid, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(sendGraphMail).not.toHaveBeenCalled();
  });

  it('throttles one IP after 5 messages', async () => {
    for (let i = 0; i < 5; i++) expect((await post(valid, '9.9.9.9')).status).toBe(200);
    expect((await post(valid, '9.9.9.9')).status).toBe(429);
  });

  it('answers 502 when the email cannot be sent', async () => {
    sendGraphMail.mockRejectedValue(new Error('smtp down'));
    expect((await post(valid)).status).toBe(502);
  });
});

describe('POST /api/contact with the Turnstile robot check on', () => {
  beforeEach(() => {
    sendGraphMail.mockReset();
    sendGraphMail.mockResolvedValue(undefined);
    process.env.TURNSTILE_SECRET_KEY = 'secret';
  });
  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = '';
    vi.unstubAllGlobals();
  });

  it('refuses a request with no token and sends nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await post(valid);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('turnstile');
    expect(sendGraphMail).not.toHaveBeenCalled();
  });

  it('refuses a token Cloudflare rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }));
    expect((await post({ ...valid, turnstileToken: 'bad' })).status).toBe(400);
    expect(sendGraphMail).not.toHaveBeenCalled();
  });

  it('sends the email when Cloudflare accepts the token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    expect((await post({ ...valid, turnstileToken: 'good' })).status).toBe(200);
    expect(sendGraphMail).toHaveBeenCalledTimes(1);
  });
});

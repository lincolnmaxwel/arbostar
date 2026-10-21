import { describe, it, expect, afterEach, vi } from 'vitest';
import { verifyTurnstile, turnstileEnabled } from '@/lib/turnstile';

const original = process.env.TURNSTILE_SECRET_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = original;
  vi.unstubAllGlobals();
});

describe('verifyTurnstile', () => {
  it('is off (always passes) without a secret key', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(undefined)).toBe(true);
  });

  it('rejects a missing token when enabled, without calling Cloudflare', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await verifyTurnstile('')).toBe(false);
    expect(await verifyTurnstile(undefined)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends secret, token and ip to siteverify and trusts success:true only', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const sent = init.body as URLSearchParams;
    expect(sent.get('secret')).toBe('secret');
    expect(sent.get('response')).toBe('tok');
    expect(sent.get('remoteip')).toBe('1.2.3.4');

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
    expect(await verifyTurnstile('tok')).toBe(false);
  });

  it('fails closed when Cloudflare cannot be reached', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await verifyTurnstile('tok')).toBe(false);
  });
});

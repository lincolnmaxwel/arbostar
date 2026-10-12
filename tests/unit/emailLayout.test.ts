import { describe, it, expect, vi, afterEach } from 'vitest';
import { emailLayout, brandLogoUrl } from '@/lib/emailLayout';

describe('emailLayout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wraps the body with the MyJobbs logo as an absolute URL on the app domain', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://myjobbs.com/');
    expect(brandLogoUrl()).toBe('https://myjobbs.com/brand/myjobbs-logo.png');
    const html = emailLayout('<p>Hello body</p>');
    expect(html).toContain('<img src="https://myjobbs.com/brand/myjobbs-logo.png"');
    expect(html).toContain('<p>Hello body</p>');
    expect(html).toContain('#075bff');
  });

  it('falls back to the production domain when NEXTAUTH_URL is unset', () => {
    vi.stubEnv('NEXTAUTH_URL', '');
    expect(brandLogoUrl()).toBe('https://myjobbs.com/brand/myjobbs-logo.png');
  });
});

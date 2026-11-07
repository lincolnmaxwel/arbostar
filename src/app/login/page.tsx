import { LoginForm } from './LoginForm';
import { turnstileSiteKey } from '@/lib/turnstile';

// The Turnstile site key is read from the environment per request, not at build time.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <LoginForm turnstileSiteKey={turnstileSiteKey()} />;
}

import Link from 'next/link';
import { SignupForm } from '@/components/SignupForm';
import styles from '@/app/login/login.module.css';
import { turnstileSiteKey } from '@/lib/turnstile';

// The Turnstile site key is read from the environment per request, not at build time.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Request access | MyJobbs',
  description: 'MyJobbs is invite-only. Request access and our team will contact you.',
};

export default function SignupPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>
        <p className={styles.subtitle}>Request access</p>
        <p className={styles.subtitle}>
          MyJobbs is by invitation. Tell us about you and our team will get in touch to approve your access.
        </p>
        <SignupForm turnstileSiteKey={turnstileSiteKey()} />
        <div className={styles.links}>
          <Link href="/login" className={styles.linkButton}>
            Already have an account? Sign in
          </Link>
          <Link href="/" className={`${styles.linkButton} ${styles.linkButtonOutline}`}>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

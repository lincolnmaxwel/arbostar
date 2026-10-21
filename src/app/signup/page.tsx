import Link from 'next/link';
import { SignupForm } from '@/components/SignupForm';
import styles from '@/app/login/login.module.css';
import { turnstileSiteKey } from '@/lib/turnstile';

// The Turnstile site key is read from the environment per request, not at build time.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Start your free trial | MyJobbs',
  description: 'Create your MyJobbs account and start your free trial.',
};

export default function SignupPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>
        <p className={styles.subtitle}>Start your free trial</p>
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

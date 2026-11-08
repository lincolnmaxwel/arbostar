import Link from 'next/link';
import { AuthBackground } from '@/components/AuthBackground';
import styles from '@/app/login/login.module.css';

export const metadata = {
  title: 'Request received | MyJobbs',
};

export default function SignupReceivedPage() {
  return (
    <div className={styles.page}>
      <AuthBackground />
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>
        <p className={styles.subtitle}>
          <strong>Email confirmed. We received your request!</strong>
        </p>
        <p className={styles.subtitle}>
          Our team is reviewing your sign-up and will contact you soon to understand your needs. Once your access is
          approved, you will get an email with the next steps.
        </p>
        <div className={styles.links}>
          <Link href="/" className={`${styles.linkButton} ${styles.linkButtonOutline}`}>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

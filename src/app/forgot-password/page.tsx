import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm';
import styles from '@/app/login/login.module.css';

export default function ForgotPasswordPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>
        <p className={styles.subtitle}>
          Enter your email and we will send you a link to choose a new password.
        </p>
        <ForgotPasswordForm />
        <div className={styles.links}>
          <Link href="/login" className={styles.linkButton}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

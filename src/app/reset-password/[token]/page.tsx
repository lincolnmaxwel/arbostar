import Link from 'next/link';
import { lookupReset } from '@/lib/passwordReset';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';
import styles from '@/app/login/login.module.css';

// Public page (outside middleware's matcher): the token in the URL is the only
// credential. Never cached — validity changes as the link is used.
export const dynamic = 'force-dynamic';

const PROBLEM_COPY: Record<'invalid' | 'expired' | 'used', { title: string; body: string }> = {
  invalid: { title: 'Link not valid', body: 'This reset link is not valid. Check that you opened the full link from your email.' },
  expired: { title: 'Link expired', body: 'This reset link has expired. Request a new one from the sign-in page.' },
  used: { title: 'Link already used', body: 'This reset link was already used. Request a new one if you still need to change your password.' },
};

export default async function ResetPasswordPage({ params }: { params: { token: string } }) {
  const lookup = await lookupReset(params.token);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>

        {lookup.state === 'valid' ? (
          <>
            <p className={styles.subtitle}>Choose a new password for {lookup.reset.email}.</p>
            <ResetPasswordForm token={params.token} email={lookup.reset.email} />
          </>
        ) : (
          <>
            <p className={styles.subtitle}>
              <strong>{PROBLEM_COPY[lookup.state].title}</strong>
            </p>
            <p className={styles.subtitle}>{PROBLEM_COPY[lookup.state].body}</p>
            <div className={styles.links}>
              <Link href="/forgot-password" className={styles.linkButton}>
                Request a new link
              </Link>
              <Link href="/login" className={styles.linkButton}>
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import Link from 'next/link';
import { lookupSignup } from '@/lib/signups';
import { VerifySignupForm } from '@/components/VerifySignupForm';
import styles from '@/app/login/login.module.css';

export const dynamic = 'force-dynamic';

const PROBLEM_COPY: Record<'invalid' | 'expired' | 'used', { title: string; body: string; href: string; link: string }> = {
  invalid: {
    title: 'Verification link not found',
    body: 'This verification link is not valid. Check that you opened the full link from your email.',
    href: '/signup',
    link: 'Request access',
  },
  expired: {
    title: 'Verification link expired',
    body: 'This verification link has expired. Start again to get a new link.',
    href: '/signup',
    link: 'Request access',
  },
  used: {
    title: 'Verification link already used',
    body: 'This email was already confirmed. Our team has your request.',
    href: '/',
    link: 'Back to home',
  },
};

export default async function VerifySignupPage({ params }: { params: { token: string } }) {
  const lookup = await lookupSignup(params.token);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>
        {lookup.state === 'valid' ? (
          <>
            <p className={styles.subtitle}>
              Confirm <strong>{lookup.signup.email}</strong> so our team can review your request.
            </p>
            <VerifySignupForm token={params.token} />
          </>
        ) : (
          <>
            <p className={styles.subtitle}>
              <strong>{PROBLEM_COPY[lookup.state].title}</strong>
            </p>
            <p className={styles.subtitle}>{PROBLEM_COPY[lookup.state].body}</p>
            <Link href={PROBLEM_COPY[lookup.state].href}>{PROBLEM_COPY[lookup.state].link}</Link>
          </>
        )}
      </div>
    </div>
  );
}

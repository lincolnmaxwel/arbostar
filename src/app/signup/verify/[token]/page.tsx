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
    link: 'Start your free trial',
  },
  expired: {
    title: 'Verification link expired',
    body: 'This verification link has expired. Start again to get a new link.',
    href: '/signup',
    link: 'Start your free trial',
  },
  used: {
    title: 'Verification link already used',
    body: 'This verification link has already been used to create an account.',
    href: '/login',
    link: 'Go to sign in',
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
            <p className={styles.subtitle}>Choose a password to create your account and start your free trial.</p>
            <VerifySignupForm token={params.token} email={lookup.signup.email} name={lookup.signup.name} />
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

import Link from 'next/link';
import { lookupInvite } from '@/lib/invites';
import { AcceptInviteForm } from '@/components/AcceptInviteForm';
import styles from '@/app/login/login.module.css';

// Public page (outside middleware's matcher): the invite token in the URL is
// the only credential. Never cached — validity changes as the invite is used.
export const dynamic = 'force-dynamic';

const PROBLEM_COPY: Record<'invalid' | 'expired' | 'used', { title: string; body: string }> = {
  invalid: { title: 'Invitation not found', body: 'This invitation link is not valid. Check that you opened the full link from your email.' },
  expired: { title: 'Invitation expired', body: 'This invitation has expired. Ask your administrator to send you a new one.' },
  used: { title: 'Invitation already used', body: 'This invitation was already used to create an account.' },
};

export default async function InvitePage({ params }: { params: { token: string } }) {
  const lookup = await lookupInvite(params.token);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>

        {lookup.state === 'valid' ? (
          <>
            <p className={styles.subtitle}>Create your password to activate your account.</p>
            <AcceptInviteForm token={params.token} email={lookup.invite.email} name={lookup.invite.name} />
          </>
        ) : (
          <>
            <p className={styles.subtitle}>
              <strong>{PROBLEM_COPY[lookup.state].title}</strong>
            </p>
            <p className={styles.subtitle}>{PROBLEM_COPY[lookup.state].body}</p>
            <Link href="/login">Go to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}

import Link from 'next/link';
import { LEGAL_LAST_UPDATED, SUPPORT_EMAIL } from '@/lib/legal';
import styles from '@/app/terms/legal.module.css';

export const metadata = {
  title: 'Privacy Policy | MyJobbs',
  description: 'The MyJobbs Privacy Policy.',
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" aria-label="MyJobbs home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
          </Link>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </div>
      </header>
      <main className={styles.content}>
        <article className={styles.article}>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.updated}>Last updated: {LEGAL_LAST_UPDATED}</p>

          <section className={styles.section}>
            <h2>What we collect</h2>
            <p>We collect information needed to provide MyJobbs, including:</p>
            <ul>
              <li>account information such as your name, email address, and sign-in details;</li>
              <li>
                business information and content you enter, including quotes, invoices, timesheets, services, and your
                clients&apos; contact details; and
              </li>
              <li>technical and usage information, such as device, browser, log, and service activity data.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>How we use information</h2>
            <p>
              We use information to operate and improve MyJobbs, authenticate users, provide customer support, process
              payments, communicate about the service, protect against misuse, and comply with legal obligations.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Service providers</h2>
            <p>
              We use trusted service providers to operate MyJobbs, including hosting providers, Stripe for payments,
              and Resend for email delivery. They may process information only as needed to provide services to us and
              under appropriate safeguards.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Retention</h2>
            <p>
              We retain information while your account is active and as needed to provide the service, meet legal and
              accounting requirements, resolve disputes, and enforce agreements. We then delete or anonymize it when it
              is no longer needed.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Your choices and rights</h2>
            <p>
              You can request access to, correction of, or deletion of your personal information by contacting us. If
              you are in Canada, you may also ask questions about how we handle your personal information under PIPEDA.
              We may need to verify your identity before responding to a request.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Security</h2>
            <p>
              We use reasonable administrative, technical, and organizational measures to protect information. No
              internet service can guarantee absolute security, so please use a strong password and keep it private.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Cookies</h2>
            <p>
              MyJobbs uses a session cookie to keep you signed in and maintain essential service functionality. We do
              not use advertising cookies.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Changes to this policy</h2>
            <p>
              We may update this policy from time to time. We will post the updated version here and revise the last
              updated date.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Contact</h2>
            <p>
              For privacy questions or requests, email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </section>
        </article>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>MyJobbs Privacy Policy</span>
          <Link href="/terms">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
}

import Link from 'next/link';
import { LEGAL_LAST_UPDATED, SUPPORT_EMAIL, TERMS_VERSION } from '@/lib/legal';
import styles from './legal.module.css';

export const metadata = {
  title: 'Terms of Service | MyJobbs',
  description: 'The MyJobbs Terms of Service.',
};

export default function TermsPage() {
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
          <h1 className={styles.title}>Terms of Service</h1>
          <p className={styles.updated}>Last updated: {LEGAL_LAST_UPDATED}</p>

          <section className={styles.section}>
            <h2>Acceptance of these terms</h2>
            <p>
              By creating an account or using MyJobbs, you agree to these Terms of Service. If you use MyJobbs on
              behalf of a business, you confirm that you are authorized to accept these terms for that business.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Accounts and security</h2>
            <p>
              You are responsible for keeping your sign-in details secure and for activity under your account. Tell us
              promptly if you believe your account has been accessed without permission. To help protect accounts,
              MyJobbs supports one active device session at a time.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Free trial and subscription billing</h2>
            <p>
              A free trial may be offered to new accounts. Its length and availability are shown in the service at the
              time of account creation. After a trial, continued access may require a paid subscription. Subscription
              payments are processed by Stripe and are subject to the billing terms shown during checkout.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Cancellation</h2>
            <p>
              You may cancel a subscription through the billing area of MyJobbs or the Stripe customer portal. Unless
              stated otherwise at checkout, cancellation takes effect at the end of the current billing period and you
              can continue using paid features until then.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Acceptable use</h2>
            <p>You may not use MyJobbs to break the law, harm others, or interfere with the service. In particular, you must not:</p>
            <ul>
              <li>attempt to gain unauthorized access to accounts, systems, or data;</li>
              <li>upload malware, send spam, or use the service to deceive others; or</li>
              <li>reverse engineer, disrupt, or overload the service.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>Your data</h2>
            <p>
              You retain ownership of the business, client, quote, invoice, timesheet, and other content you enter in
              MyJobbs. You grant us permission to process that content only as needed to provide, maintain, and secure
              the service.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Availability and warranty disclaimer</h2>
            <p>
              We work to keep MyJobbs available and reliable, but the service is provided on an &ldquo;as is&rdquo; and
              &ldquo;as available&rdquo; basis. We do not promise uninterrupted, error-free service or that the service will
              meet every business need.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, MyJobbs will not be liable for indirect, incidental, special,
              consequential, or punitive damages, or for lost profits, revenue, data, or business opportunities. Our
              total liability for a claim related to the service is limited to the amount you paid to MyJobbs in the 12
              months before the claim.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Changes to these terms</h2>
            <p>
              We may update these terms from time to time. We will post the updated version here and revise the last
              updated date. Continued use of MyJobbs after an update means you accept the revised terms.
            </p>
          </section>

          <section className={styles.section}>
            <h2>Contact</h2>
            <p>
              For questions about these terms, email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </section>
        </article>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>MyJobbs Terms of Service</span>
          <span>Version {TERMS_VERSION}</span>
        </div>
      </footer>
    </div>
  );
}

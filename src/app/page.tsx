import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import styles from './landing.module.css';
import contact from './contact.module.css';
import { ContactForm } from '@/components/ContactForm';
import { WHATSAPP_DISPLAY, whatsappUrl } from '@/lib/contact';
import { turnstileSiteKey } from '@/lib/turnstile';

export const metadata = {
  title: 'MyJobbs - Quotes, timesheets and invoices for field crews',
  description:
    'Build quotes offline, get them approved online, schedule the work and invoice with GST. One simple system for service businesses.',
};

type IconName =
  | 'offline'
  | 'portal'
  | 'calendar'
  | 'invoice'
  | 'clock'
  | 'users'
  | 'chart'
  | 'brand'
  | 'phone';

function Icon({ name }: { name: IconName }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'offline':
      return (
        <svg {...common}>
          <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
          <circle cx="12" cy="19.5" r="1" fill="currentColor" />
          <path d="M3 3l18 18" />
        </svg>
      );
    case 'portal':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 8l9 6 9-6" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4" />
        </svg>
      );
    case 'invoice':
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M14 3v5h5M9 13h7M9 17h5" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.3c1.8.8 3 2.6 3 4.7" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case 'brand':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="9" cy="10" r="2" />
          <path d="M21 16l-5-5L5 21" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...common}>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      );
  }
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'offline',
    title: 'Quotes that work offline',
    text: 'Build estimates on the job site with no signal. Everything is saved as you type, photos included, and syncs the moment you are back online.',
  },
  {
    icon: 'portal',
    title: 'Client approval link',
    text: 'Email the proposal with an itemized price breakdown. Your client approves or declines from their phone, with no account needed.',
  },
  {
    icon: 'calendar',
    title: 'Scheduling made easy',
    text: 'Offer date options for the approved job. Clients pick a day, or ask for new dates, and you get notified right away.',
  },
  {
    icon: 'invoice',
    title: 'Invoices and PDFs',
    text: 'Mark a job completed and the invoice is created, emailed with a PDF attached and ready to track as pending or paid.',
  },
  {
    icon: 'clock',
    title: 'Timesheets and services',
    text: 'Log hours and products per client against your own service catalog, then bundle open entries into a single invoice.',
  },
  {
    icon: 'users',
    title: 'Client records',
    text: 'Keep every customer and service address in one place and reuse them on the next quote instead of retyping.',
  },
  {
    icon: 'chart',
    title: 'Financial reports',
    text: 'See jobs completed, paid and outstanding by day, week, month, year or any custom period, with net, GST and total separated.',
  },
  {
    icon: 'brand',
    title: 'Your brand on every document',
    text: 'Your logo, business details and GST number appear on quotes, invoices and emails, so clients always know who they are dealing with.',
  },
];

// A step may carry a short looping demo video from public/videos (swap in the *_tiny.mp4 variant if too heavy).
const STEPS: { n: string; title: string; text: string; video?: string }[] = [
  { n: '1', title: 'Build the quote', text: 'Add line items and photos, even without internet. Send it with one tap.', video: '/videos/build_quote_tiny.mp4' },
  { n: '2', title: 'Client approves and books', text: 'They review online, approve, and choose a date that works for them.' },
  { n: '3', title: 'Invoice and get paid', text: 'Complete the job to issue the invoice, then mark it paid and send the receipt.' },
];

export default async function LandingPage() {
  // Signed-in users go straight to their work, as before.
  const session = await getServerSession(authOptions);
  if (session?.user) redirect('/quotes');

  const year = new Date().getFullYear();

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.brandLogo} />
          </Link>
          <nav className={styles.navLinks} aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#contact">Contact</a>
          </nav>
          <div className={styles.navActions}>
            <Link href="/login" className={styles.navSignIn}>
              Sign in
            </Link>
            <Link href="/signup" className={styles.navCta}>
              Start free trial
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>Built for service businesses</span>
              <h1 className={styles.heroTitle}>
                From quote to paid invoice, <span className={styles.gradientText}>all in one place.</span>
              </h1>
              <p className={styles.heroText}>
                MyJobbs helps field crews write quotes on site, get them approved online, schedule the work and invoice
                with GST. It keeps working when the signal does not.
              </p>
              <div className={styles.heroActions}>
                <Link href="/signup" className={styles.primaryButton}>
                  Start free trial
                </Link>
                <Link href="/login" className={styles.secondaryButton}>
                  Sign in
                </Link>
              </div>
              <ul className={styles.heroBadges}>
                <li>Works offline</li>
                <li>GST ready</li>
                <li>PDF invoices</li>
              </ul>
            </div>

            <div className={styles.preview} aria-hidden="true">
              <div className={styles.previewCard}>
                <div className={styles.previewHead}>
                  <div>
                    <div className={styles.previewLabel}>Estimate</div>
                    <div className={styles.previewTitle}>Oak tree removal</div>
                  </div>
                  <span className={styles.previewBadge}>Approved</span>
                </div>
                <div className={styles.previewRow}>
                  <span>Tree removal</span>
                  <strong>$1,200.00</strong>
                </div>
                <div className={styles.previewRow}>
                  <span>Stump grinding</span>
                  <strong>$280.00</strong>
                </div>
                <div className={styles.previewRow}>
                  <span>Debris haul-away</span>
                  <strong>$150.00</strong>
                </div>
                <div className={styles.previewTotals}>
                  <div>
                    <span>Subtotal</span>
                    <span>$1,630.00</span>
                  </div>
                  <div>
                    <span>GST 5.0%</span>
                    <span>$81.50</span>
                  </div>
                  <div className={styles.previewGrand}>
                    <span>Total</span>
                    <span>$1,711.50</span>
                  </div>
                </div>
              </div>
              <div className={styles.floatPaid}>
                <span className={styles.floatDot} /> Invoice paid
              </div>
              <div className={styles.floatSync}>
                <Icon name="phone" /> Synced from the field
              </div>
            </div>
          </div>
        </section>

        <section id="features" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Features</span>
              <h2 className={styles.sectionTitle}>Everything you need to run the job</h2>
              <p className={styles.sectionText}>
                Simple tools that cover the whole life of a job, without spreadsheets or paperwork.
              </p>
            </div>
            <div className={styles.grid}>
              {FEATURES.map((f) => (
                <article key={f.title} className={styles.card}>
                  <div className={styles.cardIcon}>
                    <Icon name={f.icon} />
                  </div>
                  <h3 className={styles.cardTitle}>{f.title}</h3>
                  <p className={styles.cardText}>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className={`${styles.section} ${styles.sectionAlt}`}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>How it works</span>
              <h2 className={styles.sectionTitle}>Three steps, start to finish</h2>
            </div>
            <ol className={styles.steps}>
              {STEPS.map((s) => (
                <li key={s.n} className={styles.step}>
                  <span className={styles.stepNumber}>{s.n}</span>
                  <h3 className={styles.cardTitle}>{s.title}</h3>
                  <p className={styles.cardText}>{s.text}</p>
                  {s.video && (
                    <video
                      className={styles.stepVideo}
                      src={s.video}
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      aria-label={`${s.title} demo`}
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="contact" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Contact</span>
              <h2 className={styles.sectionTitle}>Questions? Talk to us</h2>
              <p className={styles.sectionText}>
                Send us a message and we will reply by email, or chat with us directly on WhatsApp.
              </p>
            </div>
            <div className={contact.wrap}>
              <div className={contact.panel}>
                <ContactForm turnstileSiteKey={turnstileSiteKey()} />
              </div>
              <aside className={`${contact.panel} ${contact.side}`}>
                <h3 className={contact.sideTitle}>Prefer WhatsApp?</h3>
                <p className={contact.sideText}>Tap the button and the conversation opens with us, ready to send.</p>
                <a href={whatsappUrl()} className={contact.whatsapp} target="_blank" rel="noopener noreferrer">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.7-5A8.5 8.5 0 1 1 21 11.5z" /></svg>
                  Chat on WhatsApp
                </a>
                <p className={contact.number}>{WHATSAPP_DISPLAY}</p>
              </aside>
            </div>
          </div>
        </section>

        <section className={styles.ctaBand}>
          <div className={styles.container}>
            <h2 className={styles.ctaTitle}>Ready to quote smarter?</h2>
            <p className={styles.ctaText}>Create your account and start quoting, scheduling, and invoicing from one place.</p>
            <Link href="/signup" className={styles.ctaButton}>
              Start free trial
            </Link>
            <p className={styles.ctaSignIn}>
              Already have an account? <Link href="/login">Sign in</Link>
            </p>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.footerLogo} />
          <nav className={styles.footerLinks} aria-label="Legal">
            <Link href="/terms">Terms of Service</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </nav>
          <span>© {year} MyJobbs.com. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}

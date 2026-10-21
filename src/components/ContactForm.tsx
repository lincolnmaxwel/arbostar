'use client';

import { useState, type FormEvent } from 'react';
import styles from '@/app/contact.module.css';

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot, real users never fill it
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, message, website }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(body.error ?? 'We could not send your message. Please try again.');
        return;
      }
      setSent(body.message ?? 'Thanks! Your message was sent.');
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.success} role="status" data-testid="contact-success">
        <strong>Message sent.</strong>
        <p>{sent}</p>
        <button type="button" className={styles.again} onClick={() => setSent(null)}>
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
        </label>
        <label className={styles.field}>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span>Phone (optional)</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={40} />
      </label>
      <label className={styles.field}>
        <span>How can we help?</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} required maxLength={2000} />
      </label>
      <div className={styles.honeypot} aria-hidden="true">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? 'Sending...' : 'Send message'}
      </button>
    </form>
  );
}

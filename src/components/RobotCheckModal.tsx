'use client';

import { useEffect, useRef } from 'react';
import { TurnstileWidget } from '@/components/TurnstileWidget';
import styles from './RobotCheckModal.module.css';

/**
 * Centered dialog that runs the Cloudflare Turnstile check on demand and
 * hands the token back as soon as it passes (the caller then closes it and
 * submits). Mounted fresh for every attempt, so each token is a new challenge.
 */
export function RobotCheckModal({
  siteKey,
  onVerified,
  onCancel,
}: {
  siteKey: string;
  onVerified: (token: string) => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className={styles.overlay} onClick={onCancel} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="robot-check-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="robot-check-title" className={styles.title}>
          One quick check
        </h2>
        <p className={styles.text}>Please confirm you are human. Your sign-up continues right after.</p>
        <div className={styles.widget}>
          <TurnstileWidget siteKey={siteKey} onToken={(token) => token && onVerified(token)} />
        </div>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

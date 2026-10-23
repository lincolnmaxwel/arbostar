'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './StepVideo.module.css';

interface StepVideoProps {
  src: string;
  /** Higher-resolution clip shown in the enlarged view (defaults to `src`). */
  largeSrc?: string;
  label: string;
}

// The card preview plays slower than the enlarged clip so each step is easy to follow.
const PREVIEW_SPEED = 0.6;

// Looping preview inside a landing card; clicking it opens the clip enlarged.
export default function StepVideo({ src, largeSrc, label }: StepVideoProps) {
  const [open, setOpen] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);

  // playbackRate is a property, not an attribute; reapplied after metadata loads because the browser resets it.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const apply = () => {
      el.playbackRate = PREVIEW_SPEED;
    };
    apply();
    el.addEventListener('loadedmetadata', apply);
    return () => el.removeEventListener('loadedmetadata', apply);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button type="button" className={styles.preview} onClick={() => setOpen(true)} aria-label={`Enlarge: ${label}`}>
        <video ref={previewRef} className={styles.video} src={src} autoPlay loop muted playsInline preload="metadata" />
        <span className={styles.hint} aria-hidden="true">
          Click to enlarge
        </span>
      </button>
      {open && (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={label} onClick={() => setOpen(false)}>
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close video">
            ×
          </button>
          <video
            className={styles.large}
            src={largeSrc ?? src}
            autoPlay
            loop
            muted
            playsInline
            controls
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

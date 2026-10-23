'use client';

import { useEffect, useState } from 'react';
import styles from './StepVideo.module.css';

interface StepVideoProps {
  src: string;
  /** Higher-resolution clip shown in the enlarged view (defaults to `src`). */
  largeSrc?: string;
  label: string;
}

// Both the card preview and the enlarged clip play slower than normal so each step is easy to follow.
const PLAYBACK_SPEED = 0.6;

// playbackRate is a property, not an attribute, and the browser resets it once metadata loads.
function slowDown(el: HTMLVideoElement | null) {
  if (!el) return;
  el.playbackRate = PLAYBACK_SPEED;
  el.addEventListener('loadedmetadata', () => {
    el.playbackRate = PLAYBACK_SPEED;
  });
}

// Looping preview inside a landing card; clicking it opens the clip enlarged.
export default function StepVideo({ src, largeSrc, label }: StepVideoProps) {
  const [open, setOpen] = useState(false);
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
        <video ref={slowDown} className={styles.video} src={src} autoPlay loop muted playsInline preload="metadata" />
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
            ref={slowDown}
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

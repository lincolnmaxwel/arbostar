'use client';

import { useEffect, useState } from 'react';
import styles from './InstallPwaButton.module.css';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isIos() {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
}

export function InstallPwaButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  // iOS Safari never fires beforeinstallprompt — only path there is the
  // manual Share > Add to Home Screen flow, so show instructions instead.
  if (!deferredPrompt) {
    if (!isIos()) return null;
    return (
      <>
        <button type="button" className={styles.installButton} onClick={() => setShowIosHint(true)}>
          Instalar app
        </button>
        {showIosHint && (
          <div className={styles.iosHint} role="dialog">
            <p>Para instalar: toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
            <button type="button" onClick={() => setShowIosHint(false)}>Fechar</button>
          </div>
        )}
      </>
    );
  }

  return (
    <button
      type="button"
      className={styles.installButton}
      onClick={async () => {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
      }}
    >
      Instalar app
    </button>
  );
}

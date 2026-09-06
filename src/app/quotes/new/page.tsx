'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';
import { getViewContext } from '@/lib/clientUserContext';
import styles from './new-quote.module.css';

function NewQuotePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('draft');
  const [quotesEnabled, setQuotesEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getViewContext().then((ctx) => {
      if (!cancelled) setQuotesEnabled(ctx?.features.quotes ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (quotesEnabled !== true || draftId) return;
    const id = crypto.randomUUID();
    router.replace(`/quotes/new?draft=${id}`);
  }, [draftId, quotesEnabled, router]);

  if (quotesEnabled === null) return <p className={styles.loading}>Loading...</p>;
  if (!quotesEnabled) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>New quote</h1>
        <p className={styles.featureDisabled}>
          Quotes is not enabled for your account. Ask an administrator to enable it.
        </p>
      </div>
    );
  }
  if (!draftId) return <p className={styles.loading}>Loading...</p>;
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>New quote</h1>
      <QuoteBuilderForm draftId={draftId} />
    </div>
  );
}

export default function NewQuotePage() {
  return (
    <Suspense fallback={<p className={styles.loading}>Loading...</p>}>
      <NewQuotePageInner />
    </Suspense>
  );
}

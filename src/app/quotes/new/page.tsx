'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';
import styles from './new-quote.module.css';

function NewQuotePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('draft');

  useEffect(() => {
    if (!draftId) {
      const id = crypto.randomUUID();
      router.replace(`/quotes/new?draft=${id}`);
    }
  }, [draftId, router]);

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

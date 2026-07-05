'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';

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

  if (!draftId) return <p>Loading...</p>;
  return <QuoteBuilderForm draftId={draftId} />;
}

export default function NewQuotePage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <NewQuotePageInner />
    </Suspense>
  );
}

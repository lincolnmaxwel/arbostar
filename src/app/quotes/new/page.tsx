'use client';

import { useMemo } from 'react';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';

export default function NewQuotePage() {
  const draftId = useMemo(() => crypto.randomUUID(), []);
  return <QuoteBuilderForm draftId={draftId} />;
}

'use client';

import { useParams } from 'next/navigation';
import { QuoteView } from '@/components/QuoteView';

export default function QuoteViewPage() {
  const params = useParams<{ draftId: string }>();
  return <QuoteView draftId={params.draftId} />;
}

'use client';

import { useMemo } from 'react';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';

// Persist the in-progress draft's id across reloads (e.g. an offline reload) so the
// same IndexedDB draft row is resumed instead of a brand new, empty one being created
// every time this page remounts. Without this, `crypto.randomUUID()` alone would hand
// out a fresh id on every navigation/reload and silently orphan the previous draft.
const DRAFT_ID_STORAGE_KEY = 'arbostar:new-quote-draft-id';

function getOrCreateDraftId(): string {
  if (typeof window === 'undefined' || !window.localStorage) return crypto.randomUUID();
  const existing = window.localStorage.getItem(DRAFT_ID_STORAGE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(DRAFT_ID_STORAGE_KEY, id);
  return id;
}

export default function NewQuotePage() {
  const draftId = useMemo(() => getOrCreateDraftId(), []);
  return <QuoteBuilderForm draftId={draftId} />;
}

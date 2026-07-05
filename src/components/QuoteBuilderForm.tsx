'use client';

import { useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb, DraftQuote, DraftQuoteItem } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft, retryStuckEntry, clearEntry } from '@/lib/outbox';
import { runSyncCycle } from '@/lib/syncWorker';
import { debounce } from '@/lib/debounce';
import { calculateTotals } from '@/lib/quoteMath';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { compressImage } from '@/lib/compressImage';
import { addPhotoToItem, uploadPendingPhotos } from '@/lib/photoSync';

function emptyDraft(draftId: string): DraftQuote {
  return {
    draftId,
    clientName: '',
    clientEmail: '',
    items: [],
    taxRate: 0.05,
    status: 'local',
    updatedAt: Date.now(),
  };
}

export function QuoteBuilderForm({ draftId }: { draftId: string }) {
  const draft = useLiveQuery(() => localDb.drafts.get(draftId), [draftId]);
  const outboxEntry = useLiveQuery(() => getEntryForDraft(draftId), [draftId]);

  useMemo(() => {
    localDb.drafts.get(draftId).then((existing) => {
      if (!existing) localDb.drafts.put(emptyDraft(draftId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const saveLocal = useMemo(
    () =>
      debounce((next: DraftQuote) => {
        localDb.drafts.put({ ...next, status: 'local', updatedAt: Date.now() });
      }, 500),
    [],
  );

  useEffect(() => {
    if (draft?.status === 'synced') {
      uploadPendingPhotos(draftId);
    }
  }, [draft?.status, draftId]);

  if (!draft) return <p>Loading draft...</p>;

  const totals = calculateTotals(draft.items, draft.taxRate);

  function updateField<K extends keyof DraftQuote>(field: K, value: DraftQuote[K]) {
    saveLocal({ ...draft!, [field]: value });
  }

  function addItem() {
    const item: DraftQuoteItem = { id: crypto.randomUUID(), title: '', price: 0, photoIds: [] };
    updateField('items', [...draft!.items, item]);
  }

  function updateItem(id: string, patch: Partial<DraftQuoteItem>) {
    updateField(
      'items',
      draft!.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  }

  async function handleSend() {
    await localDb.drafts.update(draftId, { status: 'syncing' });
    await enqueueSync(draftId);
  }

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <SyncStatusBadge status={draft.status} />
      <label htmlFor="clientName">Client name</label>
      <input id="clientName" value={draft.clientName} onChange={(e) => updateField('clientName', e.target.value)} />
      <label htmlFor="clientEmail">Client email</label>
      <input id="clientEmail" value={draft.clientEmail} onChange={(e) => updateField('clientEmail', e.target.value)} />
      {draft.items.map((item) => (
        <div key={item.id}>
          <label htmlFor={`title-${item.id}`}>Service title</label>
          <input id={`title-${item.id}`} value={item.title} onChange={(e) => updateItem(item.id, { title: e.target.value })} />
          <label htmlFor={`price-${item.id}`}>Price</label>
          <input
            id={`price-${item.id}`}
            type="number"
            value={item.price}
            onChange={(e) => updateItem(item.id, { price: Number(e.target.value) })}
          />
          <label htmlFor={`photo-${item.id}`}>Add photo for {item.title || 'this service'}</label>
          <input
            id={`photo-${item.id}`}
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const compressed = await compressImage(file);
              await addPhotoToItem(draftId, item.id, compressed, file.name);
            }}
          />
          <span data-testid={`photo-count-${item.id}`}>{item.photoIds.length} photo(s)</span>
        </div>
      ))}
      <button type="button" onClick={addItem}>Add service</button>
      <p>Total: {totals.total}</p>
      <button type="button" onClick={handleSend}>Send</button>
      {draft.status === 'error' && outboxEntry && (
        <div role="alert" data-testid="conflict-banner">
          <p>{outboxEntry.lastError}</p>
          <button
            type="button"
            onClick={async () => {
              await retryStuckEntry(outboxEntry.id!);
              await runSyncCycle();
            }}
          >
            Retry
          </button>
          <button
            type="button"
            onClick={async () => {
              await clearEntry(outboxEntry.id!);
              await localDb.drafts.update(draftId, { status: 'local' });
            }}
          >
            Discard sync, keep editing
          </button>
        </div>
      )}
    </form>
  );
}

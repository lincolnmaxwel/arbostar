'use client';

import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb, DraftQuote, DraftQuoteItem } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft, retryStuckEntry, clearEntry } from '@/lib/outbox';
import { runSyncCycle } from '@/lib/syncWorker';
import { debounce } from '@/lib/debounce';
import { calculateTotals } from '@/lib/quoteMath';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { compressImage } from '@/lib/compressImage';
import { addPhotoToItem, uploadPendingPhotos } from '@/lib/photoSync';
import styles from './QuoteBuilderForm.module.css';

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
  const [formState, setFormState] = useState<DraftQuote | null>(null);

  useEffect(() => {
    localDb.drafts.get(draftId).then((existing) => {
      if (!existing) localDb.drafts.put(emptyDraft(draftId));
    });
  }, [draftId]);

  useEffect(() => {
    if (draft && !formState) {
      setFormState(draft);
    }
  }, [draft, formState]);

  const persist = useMemo(
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

  if (!formState) return <p className={styles.loading}>Loading draft...</p>;

  const totals = calculateTotals(formState.items, formState.taxRate);

  function updateField<K extends keyof DraftQuote>(field: K, value: DraftQuote[K]) {
    const next = { ...formState, [field]: value } as DraftQuote;
    setFormState(next);
    persist(next);
  }

  function addItem() {
    const item: DraftQuoteItem = { id: crypto.randomUUID(), title: '', price: 0, photoIds: [] };
    updateField('items', [...formState!.items, item]);
  }

  function updateItem(id: string, patch: Partial<DraftQuoteItem>) {
    updateField(
      'items',
      formState!.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  }

  async function handleSend() {
    await localDb.drafts.update(draftId, { status: 'syncing' });
    await enqueueSync(draftId);
  }

  return (
    <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Client details</h2>
        <div className={styles.field}>
          <label htmlFor="clientName">Client name</label>
          <input id="clientName" className={styles.input} value={formState.clientName} onChange={(e) => updateField('clientName', e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="clientEmail">Client email</label>
          <input id="clientEmail" className={styles.input} value={formState.clientEmail} onChange={(e) => updateField('clientEmail', e.target.value)} />
        </div>
      </div>

      <div className={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 className={styles.sectionTitle} style={{ margin: 0, border: 'none', padding: 0 }}>Services</h2>
          <SyncStatusBadge status={draft?.status ?? formState.status} />
        </div>

        {formState.items.map((item) => (
          <div key={item.id} className={styles.itemCard}>
            <div className={styles.itemCardFields}>
              <div className={`${styles.itemField} ${styles.itemFieldFull}`}>
                <label htmlFor={`title-${item.id}`}>Service title</label>
                <input id={`title-${item.id}`} className={styles.itemInput} value={item.title} onChange={(e) => updateItem(item.id, { title: e.target.value })} />
              </div>
              <div className={styles.itemField}>
                <label htmlFor={`price-${item.id}`}>Price ($)</label>
                <input
                  id={`price-${item.id}`}
                  className={styles.itemInput}
                  type="number"
                  value={item.price}
                  onChange={(e) => updateItem(item.id, { price: Number(e.target.value) })}
                />
              </div>
              <div className={styles.itemField}>
                <label>Photo</label>
                <label htmlFor={`photo-${item.id}`} className={styles.photoButton}>
                  + Attach photo
                </label>
                <input
                  id={`photo-${item.id}`}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const compressed = await compressImage(file);
                    const photoId = await addPhotoToItem(draftId, compressed, file.name);
                    updateItem(item.id, { photoIds: [...item.photoIds, photoId] });
                  }}
                />
                <span className={styles.photoCount} data-testid={`photo-count-${item.id}`}>{item.photoIds.length} photo(s)</span>
              </div>
            </div>
          </div>
        ))}

        <button type="button" className={styles.addItemButton} onClick={addItem}>+ Add service</button>
      </div>

      <div className={styles.totals}>
        <div className={styles.totalItem}>
          <div className={styles.totalItemLabel}>Subtotal</div>
          <div className={styles.totalItemValue}>${totals.subtotal.toFixed(2)}</div>
        </div>
        <div className={styles.totalItem}>
          <div className={styles.totalItemLabel}>Tax ({(formState.taxRate * 100).toFixed(1)}%)</div>
          <div className={styles.totalItemValue}>${totals.taxAmount.toFixed(2)}</div>
        </div>
        <div className={styles.totalItem}>
          <div className={styles.totalItemLabel}>Total</div>
          <div className={styles.totalItemValueGrand}>${totals.total.toFixed(2)}</div>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.sendButton} onClick={handleSend} disabled={formState.items.length === 0}>
          {draft?.status === 'syncing' ? 'Sending...' : 'Send quote'}
        </button>
      </div>

      {draft?.status === 'error' && outboxEntry && (
        <div className={styles.conflictBanner} role="alert" data-testid="conflict-banner">
          <span className={styles.conflictText}>{outboxEntry.lastError}</span>
          <div className={styles.conflictActions}>
            <button
              type="button"
              className={styles.retryButton}
              onClick={async () => {
                await retryStuckEntry(outboxEntry.id!);
                await runSyncCycle();
              }}
            >
              Retry
            </button>
            <button
              type="button"
              className={styles.discardButton}
              onClick={async () => {
                await clearEntry(outboxEntry.id!);
                await localDb.drafts.update(draftId, { status: 'local' });
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

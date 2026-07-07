'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb, DraftQuote, DraftQuoteItem } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft, retryStuckEntry, clearEntry } from '@/lib/outbox';
import { runSyncCycle, isReallyOnline } from '@/lib/syncWorker';
import { debounce } from '@/lib/debounce';
import { calculateTotals, formatMoney } from '@/lib/quoteMath';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { compressImage } from '@/lib/compressImage';
import { addPhotoToItem, uploadPendingPhotos } from '@/lib/photoSync';
import { formatPhoneInput } from '@/lib/formatPhone';
import styles from './QuoteBuilderForm.module.css';

interface ExistingClient {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
}

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
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [syncingNow, setSyncingNow] = useState(false);
  const [focusedPriceId, setFocusedPriceId] = useState<string | null>(null);
  const [clients, setClients] = useState<ExistingClient[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const router = useRouter();

  // Confirmed clients (at least one scheduled job — see /api/clients) a repeat
  // customer's info can be reused from, instead of retyping it every time.
  useEffect(() => {
    fetch('/api/clients')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.clients) setClients(body.clients);
      })
      .catch(() => {});
  }, []);

  // Seed formState from an existing draft if one's already persisted, or from
  // an in-memory empty draft otherwise. Deliberately does NOT write anything
  // to localDb.drafts here: just opening the builder (and leaving without
  // typing anything) must not create a visible "Untitled" entry in the
  // quotes list. The row only starts existing once the user's first edit
  // reaches the debounced persist() below.
  useEffect(() => {
    let cancelled = false;
    setFormState(null);
    localDb.drafts.get(draftId).then((existing) => {
      if (!cancelled) setFormState(existing ?? emptyDraft(draftId));
    });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  // formState is the authoritative snapshot for user-editable fields (so typing
  // in one field can't be dropped by a stale read of another field's edit), but
  // draft.serverId and each item's serverItemId are worker-owned: the sync
  // worker writes them into Dexie once a sync succeeds. Without reconciling
  // them back into formState, the next debounced persist() would overwrite
  // Dexie with formState's stale (missing) serverId/serverItemId, silently
  // undoing the sync worker's own write.
  useEffect(() => {
    if (!draft) return;
    setFormState((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) => {
        const synced = draft.items.find((d) => d.id === item.id);
        if (synced?.serverItemId && synced.serverItemId !== item.serverItemId) {
          return { ...item, serverItemId: synced.serverItemId };
        }
        return item;
      });
      const itemsChanged = items.some((item, i) => item !== prev.items[i]);
      const serverIdChanged = Boolean(draft.serverId) && draft.serverId !== prev.serverId;
      if (!itemsChanged && !serverIdChanged) return prev;
      return { ...prev, items, serverId: draft.serverId ?? prev.serverId };
    });
  }, [draft]);

  const photoIdsKey = formState?.items.map((i) => i.photoIds.join(',')).join('|') ?? '';

  useEffect(() => {
    if (!photoIdsKey) {
      setPhotoUrls({});
      return;
    }
    let cancelled = false;
    const urlsToRevoke: string[] = [];
    const allPhotoIds = photoIdsKey.split('|').flatMap((s) => (s ? s.split(',') : []));
    (async () => {
      const map: Record<string, string> = {};
      for (const photoId of allPhotoIds) {
        const photo = await localDb.photos.get(photoId);
        if (photo) {
          const url = URL.createObjectURL(photo.blob);
          map[photoId] = url;
          urlsToRevoke.push(url);
        }
      }
      if (!cancelled) setPhotoUrls(map);
    })();
    return () => {
      cancelled = true;
      urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoIdsKey]);

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
  const hasClientName = formState.clientName.trim().length > 0;
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formState.clientEmail);
  const hasItems = formState.items.length > 0;
  const canSend = hasClientName && hasValidEmail && hasItems;

  function updateField<K extends keyof DraftQuote>(field: K, value: DraftQuote[K]) {
    const next = { ...formState, [field]: value } as DraftQuote;
    setFormState(next);
    persist(next);
  }

  // A single merged update, not four updateField() calls — updateField reads
  // `formState` from this render's closure, so four calls in a row would each
  // spread from the SAME stale snapshot and only the last one would stick
  // (the exact multi-field-edit race this file's persist() design exists to
  // avoid elsewhere).
  function selectClient(client: ExistingClient) {
    const next: DraftQuote = {
      ...formState!,
      clientName: client.name,
      clientEmail: client.email,
      clientPhone: client.phone ?? undefined,
      clientAddress: client.address ?? undefined,
    };
    setFormState(next);
    persist(next);
    setClientSearch('');
    setClientDropdownOpen(false);
  }

  const clientMatches =
    clientSearch.trim().length === 0
      ? []
      : clients.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(clientSearch.trim().toLowerCase())).slice(0, 8);

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

  function removeItem(id: string) {
    updateField('items', formState!.items.filter((i) => i.id !== id));
  }

  async function handlePhotoFiles(itemId: string, files: FileList) {
    const currentItem = formState!.items.find((i) => i.id === itemId);
    if (!currentItem) return;
    const newPhotoIds: string[] = [];
    for (const file of Array.from(files)) {
      const compressed = await compressImage(file);
      newPhotoIds.push(await addPhotoToItem(draftId, compressed, file.name));
    }
    updateItem(itemId, { photoIds: [...currentItem.photoIds, ...newPhotoIds] });
  }

  function removePhoto(itemId: string, photoId: string) {
    const currentItem = formState!.items.find((i) => i.id === itemId);
    if (!currentItem) return;
    localDb.photos.delete(photoId);
    updateItem(itemId, { photoIds: currentItem.photoIds.filter((id) => id !== photoId) });
  }

  async function submit(pendingSend: boolean) {
    // .put() (not .update()) so this is safe even if the user typed fast
    // enough to click a submit button before the debounced persist() ever
    // created the row — submitting always writes the current, full
    // formState itself.
    //
    // status only goes to 'syncing' when actually online: runSyncCycle bails
    // out immediately (without touching the draft) whenever it detects no
    // real connectivity, so an offline Save would otherwise leave status
    // stuck at 'syncing' forever — permanently disabling the Save/Send
    // buttons (they're disabled while status === 'syncing') until the device
    // happens to come back online. Staying at 'local' offline keeps the form
    // usable; enqueueSync below still queues the row so the background sync
    // loop picks it up the moment connectivity actually returns.
    //
    // isReallyOnline() (a real fetch, same check the sync loop uses) instead
    // of navigator.onLine: navigator.onLine only reflects whether the device
    // has a network interface up at all — it reports true on a wifi with no
    // real internet (captive portal, ISP down), which would otherwise still
    // send this down the "online" path below and hit the same broken
    // navigation this whole check exists to avoid.
    const online = await isReallyOnline();
    await localDb.drafts.put({ ...formState!, status: online ? 'syncing' : 'local', pendingSend, updatedAt: Date.now() });
    await enqueueSync(draftId);
    // /quotes/[draftId] is a dynamic route the service worker has no generic
    // cache entry for — if this draftId's view page was never visited online
    // before, navigating there while offline fails as a hard navigation (no
    // cached match), which blows away the whole SPA and looks to the user
    // like the save itself was lost. Only navigate when there's a real
    // chance the network request succeeds.
    if (online) {
      router.push(`/quotes/${draftId}`);
    }
  }

  async function handleSave() {
    await submit(false);
  }

  async function handleSaveAndSend() {
    await submit(true);
  }

  return (
    <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Client details</h2>
        {clients.length > 0 && (
          <div className={styles.field} style={{ position: 'relative' }}>
            <label htmlFor="clientSearch">Existing client</label>
            <input
              id="clientSearch"
              className={styles.input}
              placeholder="Search by name or email to reuse their info..."
              value={clientSearch}
              onChange={(e) => {
                setClientSearch(e.target.value);
                setClientDropdownOpen(true);
              }}
              onFocus={() => setClientDropdownOpen(true)}
              onBlur={() => setTimeout(() => setClientDropdownOpen(false), 150)}
            />
            {clientDropdownOpen && clientMatches.length > 0 && (
              <ul className={styles.clientDropdown} role="listbox">
                {clientMatches.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={styles.clientOption} onMouseDown={() => selectClient(c)}>
                      <span className={styles.clientOptionName}>{c.name}</span>
                      <span className={styles.clientOptionEmail}>{c.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor="clientName">Client name</label>
          <input id="clientName" className={styles.input} value={formState.clientName} onChange={(e) => updateField('clientName', e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="clientEmail">Client email</label>
          <input id="clientEmail" type="email" className={styles.input} value={formState.clientEmail} onChange={(e) => updateField('clientEmail', e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="clientPhone">Client phone</label>
          <input
            id="clientPhone"
            type="tel"
            className={styles.input}
            placeholder="(555) 123-4567"
            value={formState.clientPhone ?? ''}
            onChange={(e) => updateField('clientPhone', formatPhoneInput(e.target.value))}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="serviceAddress">Service address</label>
          <input id="serviceAddress" className={styles.input} value={formState.serviceAddress ?? ''} onChange={(e) => updateField('serviceAddress', e.target.value)} />
        </div>
      </div>

      <div className={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 className={styles.sectionTitle} style={{ margin: 0, border: 'none', padding: 0 }}>Services</h2>
          <SyncStatusBadge status={draft?.status ?? formState.status} />
        </div>

        {formState.items.map((item) => (
          <div key={item.id} className={styles.itemCard}>
            <div className={styles.itemCardHeader}>
              <button
                type="button"
                className={styles.removeItemButton}
                onClick={() => removeItem(item.id)}
                aria-label={`Remove ${item.title || 'this service'}`}
              >
                Remove
              </button>
            </div>
            <div className={styles.itemCardFields}>
              <div className={`${styles.itemField} ${styles.itemFieldFull}`}>
                <label htmlFor={`title-${item.id}`}>Service title</label>
                <input id={`title-${item.id}`} className={styles.itemInput} value={item.title} onChange={(e) => updateItem(item.id, { title: e.target.value })} />
              </div>
              <div className={`${styles.itemField} ${styles.itemFieldFull}`}>
                <label htmlFor={`description-${item.id}`}>Description</label>
                <textarea
                  id={`description-${item.id}`}
                  className={styles.itemInput}
                  rows={3}
                  value={item.description ?? ''}
                  onChange={(e) => updateItem(item.id, { description: e.target.value })}
                />
              </div>
              <div className={styles.itemField}>
                <label htmlFor={`price-${item.id}`}>Price ($)</label>
                <input
                  id={`price-${item.id}`}
                  className={styles.itemInput}
                  type="number"
                  value={focusedPriceId === item.id && item.price === 0 ? '' : item.price}
                  onFocus={() => setFocusedPriceId(item.id)}
                  onBlur={() => setFocusedPriceId(null)}
                  onChange={(e) => updateItem(item.id, { price: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
              </div>
              <div className={`${styles.itemField} ${styles.itemFieldFull}`}>
                <label>Photo</label>
                <div className={styles.photoActions}>
                  <label htmlFor={`photo-${item.id}`} className={styles.photoButton}>
                    + Attach photo
                  </label>
                  <input
                    id={`photo-${item.id}`}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      if (!e.target.files || e.target.files.length === 0) return;
                      await handlePhotoFiles(item.id, e.target.files);
                      e.target.value = '';
                    }}
                  />
                  {item.photoIds.length > 0 && (
                    <span className={styles.photoCount} data-testid={`photo-count-${item.id}`}>{item.photoIds.length} photo(s)</span>
                  )}
                </div>
                {item.photoIds.length > 0 && (
                  <div className={styles.photoThumbs}>
                    {item.photoIds.map((photoId) => {
                      if (!photoUrls[photoId]) return null;
                      return (
                        <div key={photoId} className={styles.photoThumbWrap}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoUrls[photoId]}
                            className={styles.photoThumb}
                            alt=""
                          />
                          <button
                            type="button"
                            className={styles.photoThumbRemove}
                            onClick={() => removePhoto(item.id, photoId)}
                            aria-label="Remove photo"
                          >
                            &times;
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        <button type="button" className={styles.addItemButton} onClick={addItem}>+ Add service</button>
      </div>

      <div className={styles.totals}>
        <div className={styles.totalItem}>
          <div className={styles.totalItemLabel}>Subtotal</div>
          <div className={styles.totalItemValue}>{formatMoney(totals.subtotal)}</div>
        </div>
        <div className={styles.totalItem}>
          <div className={styles.totalItemLabel}>Tax ({(formState.taxRate * 100).toFixed(1)}%)</div>
          <div className={styles.totalItemValue}>{formatMoney(totals.taxAmount)}</div>
        </div>
        <div className={styles.totalItem}>
          <div className={styles.totalItemLabel}>Total</div>
          <div className={styles.totalItemValueGrand}>{formatMoney(totals.total)}</div>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.saveButton} onClick={handleSave} disabled={!canSend || draft?.status === 'syncing'}>
          {draft?.status === 'syncing' ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className={styles.sendButton} onClick={handleSaveAndSend} disabled={!canSend || draft?.status === 'syncing'}>
          {draft?.status === 'syncing' ? 'Saving...' : 'Save and Send'}
        </button>
        {!canSend && (
          <p className={styles.sendHint}>
            {!hasClientName && 'Client name is required. '}
            {!hasValidEmail && 'A valid client email is required. '}
            {!hasItems && 'Add at least one service.'}
          </p>
        )}
      </div>

      {draft?.status === 'local' && outboxEntry && (
        <div className={styles.pendingSyncBanner} role="status" data-testid="pending-sync-banner">
          <span className={styles.pendingSyncText}>
            Saved on this device — waiting for a connection to sync to the server.
          </span>
          <button
            type="button"
            className={styles.syncNowButton}
            disabled={syncingNow}
            onClick={async () => {
              setSyncingNow(true);
              await runSyncCycle();
              setSyncingNow(false);
            }}
          >
            {syncingNow ? 'Syncing...' : 'Sync now'}
          </button>
        </div>
      )}

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

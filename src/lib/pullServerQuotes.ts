import { localDb, DraftQuote, DraftQuoteItem } from '@/lib/localDb';

interface ServerQuoteItem {
  id: string;
  localItemId: string;
  title: string;
  description?: string | null;
  price: string | number;
}

interface ServerQuote {
  id: string;
  draftId: string;
  client: { name: string; email: string; phone?: string | null; address?: string | null };
  taxRate: string | number;
  items: ServerQuoteItem[];
  updatedAt: string;
}

// The Quotes list is a pure IndexedDB view (offline-first by design), so a
// quote synced from another device never shows up here — and an edit synced
// from another device never refreshes here either — on their own. Pull the
// server's full list and, for each quote:
//   - unknown draftId here -> insert it
//   - known here but this device has no unsynced changes of its own
//     (status 'synced') and the server copy is newer -> refresh it
//   - known here with unsynced local changes (status 'local'/'syncing'/
//     'error') -> leave it alone; this device's own outbox sync is the only
//     thing allowed to overwrite it, otherwise a pending edit gets clobbered
//     right before it has a chance to sync out
//   - queued for local deletion (pendingDeletes) -> skip, or the delete
//     would be silently undone by resurrecting the quote from the server
// Photos aren't backfilled — they live only as local blobs on whichever
// device captured them, so a pulled/refreshed quote shows its text/pricing
// but not photos captured on another device.
export async function pullServerQuotes(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/quotes', { cache: 'no-store' });
  } catch {
    return;
  }
  if (!res.ok) return;

  const body = (await res.json().catch(() => null)) as { quotes?: ServerQuote[] } | null;
  const quotes = body?.quotes;
  if (!Array.isArray(quotes)) return;

  const pendingDeleteServerIds = new Set((await localDb.pendingDeletes.toArray()).map((p) => p.serverId));
  const serverIds = new Set(quotes.map((q) => q.id));

  // A quote deleted on another device (or by this one, once its own
  // pendingDelete already flushed) simply stops appearing in this list. Mirror
  // that locally: any fully-synced draft whose serverId no longer shows up
  // server-side gets removed here too. Only 'synced' drafts qualify — a draft
  // with its own unsynced local edits keeps existing until that edit resolves
  // (same "don't clobber pending local work" rule as the refresh path below).
  const localSynced = await localDb.drafts.where('status').equals('synced').toArray();
  for (const local of localSynced) {
    if (local.serverId && !serverIds.has(local.serverId)) {
      const photoIds = local.items.flatMap((i) => i.photoIds);
      if (photoIds.length > 0) await localDb.photos.bulkDelete(photoIds);
      await localDb.drafts.delete(local.draftId);
    }
  }

  for (const q of quotes) {
    if (pendingDeleteServerIds.has(q.id)) continue;

    const existing = await localDb.drafts.get(q.draftId);
    const serverUpdatedAt = new Date(q.updatedAt).getTime();
    if (existing) {
      if (existing.status !== 'synced') continue;
      if (serverUpdatedAt <= existing.updatedAt) continue;
    }

    const existingPhotosByItemId = new Map(existing?.items.map((i) => [i.id, i.photoIds]) ?? []);
    const items: DraftQuoteItem[] = q.items.map((i) => ({
      id: i.localItemId,
      serverItemId: i.id,
      title: i.title,
      description: i.description ?? undefined,
      price: Number(i.price),
      photoIds: existingPhotosByItemId.get(i.localItemId) ?? [],
    }));

    const draft: DraftQuote = {
      draftId: q.draftId,
      serverId: q.id,
      clientName: q.client.name,
      clientEmail: q.client.email,
      clientPhone: q.client.phone ?? undefined,
      clientAddress: q.client.address ?? undefined,
      items,
      taxRate: Number(q.taxRate),
      status: 'synced',
      updatedAt: serverUpdatedAt,
    };
    await localDb.drafts.put(draft);
  }
}

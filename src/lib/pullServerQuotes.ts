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
// quote synced from another device never shows up here on its own — this
// device's Dexie simply never heard about it. Pull the server's full list
// and fill in any draftId this device doesn't already know about. Existing
// local rows are left untouched: this device's own copy may have newer
// unsynced edits, and the one-way outbox sync is the only thing allowed to
// overwrite it. Photos aren't backfilled — they live only as local blobs on
// whichever device captured them, so a quote pulled from another device will
// show its text/pricing but not its photos.
export async function pullServerQuotes(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/quotes', { cache: 'no-store' });
  } catch {
    return;
  }
  if (!res.ok) return;

  const { quotes } = (await res.json()) as { quotes: ServerQuote[] };

  for (const q of quotes) {
    const existing = await localDb.drafts.get(q.draftId);
    if (existing) continue;

    const items: DraftQuoteItem[] = q.items.map((i) => ({
      id: i.localItemId,
      serverItemId: i.id,
      title: i.title,
      description: i.description ?? undefined,
      price: Number(i.price),
      photoIds: [],
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
      updatedAt: new Date(q.updatedAt).getTime(),
    };
    await localDb.drafts.put(draft);
  }
}

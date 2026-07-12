import { localDb } from '@/lib/localDb';
import { dueEntries, recordFailure, markStuck, clearEntry } from '@/lib/outbox';
import { flushPendingDeletes } from '@/lib/pendingDeletes';
import { pullServerQuotes } from '@/lib/pullServerQuotes';
import { uploadPendingPhotos } from '@/lib/photoSync';

export async function isReallyOnline(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runSyncCycle(): Promise<void> {
  if (!(await isReallyOnline())) return;

  await flushPendingDeletes();
  // Runs every cycle (every 5s, plus on the 'online' event) app-wide via
  // startSyncLoop — not just when the Quotes list happens to be open — so an
  // edit or delete made on another device shows up here within a few seconds
  // instead of only the next time this page is manually reloaded.
  await pullServerQuotes();

  const entries = await dueEntries();
  for (const entry of entries) {
    const draft = await localDb.drafts.get(entry.draftId);
    if (!draft) {
      await clearEntry(entry.id!);
      continue;
    }
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: draft.draftId,
          clientName: draft.clientName,
          clientEmail: draft.clientEmail,
          clientPhone: draft.clientPhone,
          clientAddress: draft.clientAddress,
          serviceAddress: draft.serviceAddress,
          taxRate: draft.taxRate,
          items: draft.items.map((i) => ({ localItemId: i.id, title: i.title, description: i.description, price: i.price })),
          clientUpdatedAt: draft.updatedAt,
          send: draft.pendingSend === true,
        }),
      });

      if (res.ok) {
        const responseBody = await res.json();
        const serverItemByLocalId = new Map<string, string>(
          responseBody.quote.items.map((si: { id: string; localItemId: string }) => [si.localItemId, si.id]),
        );
        const items = draft.items.map((i) => ({ ...i, serverItemId: serverItemByLocalId.get(i.id) ?? i.serverItemId }));
        // pendingSend is a one-shot signal for this specific POST — clear it so a
        // later plain edit-and-autosave never re-sends the email. approvalStatus/
        // bookingStatus reflect this quote's business status right away (Draft
        // vs Pending approval vs already Approved/Scheduled from an earlier
        // response) rather than waiting for the next periodic pull.
        await localDb.drafts.update(draft.draftId, {
          serverId: responseBody.quote.id,
          status: 'synced',
          items,
          pendingSend: false,
          approvalStatus: responseBody.quote.status,
          bookingStatus: responseBody.quote.bookingStatus,
        });
        await clearEntry(entry.id!);
      } else if (res.status === 409 || (res.status >= 400 && res.status < 500)) {
        await localDb.drafts.update(draft.draftId, { status: 'error' });
        await markStuck(entry.id!, `sync failed: HTTP ${res.status}`);
      } else {
        await recordFailure(entry.id!, `server error ${res.status}`);
      }
    } catch (err) {
      await recordFailure(entry.id!, (err as Error).message);
    }
  }

  // Photo uploads only ever got ONE shot before: a single useEffect in
  // QuoteBuilderForm, fired once when a draft's status first transitioned to
  // 'synced'. If that one attempt didn't finish — the tab closed, the app
  // got backgrounded on mobile mid-request, a flaky connection dropped it —
  // nothing ever retried it, so the photo stayed on this device forever and
  // never reached the server (invisible to every other device and the
  // public portal, even though the quote's text/pricing synced fine). Retry
  // every cycle instead, for every locally-synced draft, so it recovers on
  // its own the next time this device is online with the app open.
  const syncedDrafts = await localDb.drafts.where('status').equals('synced').toArray();
  for (const draft of syncedDrafts) {
    await uploadPendingPhotos(draft.draftId);
  }
}

export function startSyncLoop(intervalMs = 5000): () => void {
  const timer = setInterval(runSyncCycle, intervalMs);
  const onOnline = () => runSyncCycle();
  window.addEventListener('online', onOnline);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
  };
}

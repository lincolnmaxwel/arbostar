import { localDb } from '@/lib/localDb';

export async function queuePendingDelete(serverId: string, draftId: string): Promise<void> {
  await localDb.pendingDeletes.put({ serverId, draftId, createdAt: Date.now() });
}

// Undoes a queued delete: drops the queue entry and clears the draft's
// pendingDelete flag, so the Quotes list shows it as a normal row again.
export async function cancelPendingDelete(serverId: string, draftId: string): Promise<void> {
  await localDb.pendingDeletes.delete(serverId);
  await localDb.drafts.update(draftId, { pendingDelete: false });
}

// Best-effort: attempts every queued delete, leaves whichever ones still
// fail (offline, or a transient server error) queued for the next call.
// Safe to call opportunistically (right after queuing) and periodically
// (from the sync loop) — a 404 means the server copy is already gone,
// which counts as success here. Only on success does the local draft row
// (and its photos) actually get removed — until then it stays in Dexie with
// pendingDelete: true so the user can see it's queued, and cancel it.
export async function flushPendingDeletes(): Promise<void> {
  const pending = await localDb.pendingDeletes.toArray();
  for (const p of pending) {
    try {
      const res = await fetch(`/api/quotes/${p.serverId}`, { method: 'DELETE' });
      if (res.ok || res.status === 404) {
        const draft = await localDb.drafts.get(p.draftId);
        if (draft) {
          const photoIds = draft.items.flatMap((item) => item.photoIds);
          if (photoIds.length > 0) await localDb.photos.bulkDelete(photoIds);
          await localDb.drafts.delete(p.draftId);
        }
        await localDb.pendingDeletes.delete(p.serverId);
      }
    } catch {
      // offline or network error — leave it queued for the next attempt
    }
  }
}

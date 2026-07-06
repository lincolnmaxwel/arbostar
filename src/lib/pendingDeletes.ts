import { localDb } from '@/lib/localDb';

export async function queuePendingDelete(serverId: string, draftId: string): Promise<void> {
  await localDb.pendingDeletes.put({ serverId, draftId, createdAt: Date.now() });
}

// Best-effort: attempts every queued delete, leaves whichever ones still
// fail (offline, or a transient server error) queued for the next call.
// Safe to call opportunistically (right after queuing) and periodically
// (from the sync loop) — a 404 means the server copy is already gone,
// which counts as success here.
export async function flushPendingDeletes(): Promise<void> {
  const pending = await localDb.pendingDeletes.toArray();
  for (const p of pending) {
    try {
      const res = await fetch(`/api/quotes/${p.serverId}`, { method: 'DELETE' });
      if (res.ok || res.status === 404) {
        await localDb.pendingDeletes.delete(p.serverId);
      }
    } catch {
      // offline or network error — leave it queued for the next attempt
    }
  }
}

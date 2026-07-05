import { localDb } from '@/lib/localDb';
import { dueEntries, recordFailure, markStuck, clearEntry } from '@/lib/outbox';

async function isReallyOnline(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runSyncCycle(): Promise<void> {
  if (!(await isReallyOnline())) return;

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
          taxRate: draft.taxRate,
          items: draft.items.map((i) => ({ localItemId: i.id, title: i.title, description: i.description, price: i.price })),
          clientUpdatedAt: draft.updatedAt,
        }),
      });

      if (res.ok) {
        const responseBody = await res.json();
        const serverItemByLocalId = new Map<string, string>(
          responseBody.quote.items.map((si: { id: string; localItemId: string }) => [si.localItemId, si.id]),
        );
        const items = draft.items.map((i) => ({ ...i, serverItemId: serverItemByLocalId.get(i.id) ?? i.serverItemId }));
        await localDb.drafts.update(draft.draftId, { serverId: responseBody.quote.id, status: 'synced', items });
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

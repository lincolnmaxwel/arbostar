import { localDb, OutboxEntry } from '@/lib/localDb';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
const STUCK_DELAY_MS = Number.MAX_SAFE_INTEGER;

export async function enqueueSync(draftId: string): Promise<void> {
  const existing = await getEntryForDraft(draftId);
  if (existing) {
    await localDb.outbox.update(existing.id!, { nextAttemptAt: Date.now() });
    return;
  }
  await localDb.outbox.add({
    draftId,
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
}

export function nextBackoffDelay(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
}

export async function recordFailure(entryId: number, error: string): Promise<void> {
  const entry = await localDb.outbox.get(entryId);
  if (!entry) return;
  const attempts = entry.attempts + 1;
  await localDb.outbox.update(entryId, {
    attempts,
    lastError: error,
    nextAttemptAt: Date.now() + nextBackoffDelay(attempts),
  });
}

export async function markStuck(entryId: number, error: string): Promise<void> {
  await localDb.outbox.update(entryId, { lastError: error, nextAttemptAt: STUCK_DELAY_MS });
}

export async function retryStuckEntry(entryId: number): Promise<void> {
  await localDb.outbox.update(entryId, { nextAttemptAt: Date.now(), attempts: 0 });
}

export async function clearEntry(entryId: number): Promise<void> {
  await localDb.outbox.delete(entryId);
}

export async function dueEntries(): Promise<OutboxEntry[]> {
  const now = Date.now();
  return localDb.outbox.filter((e) => e.nextAttemptAt <= now).toArray();
}

export async function getEntryForDraft(draftId: string): Promise<OutboxEntry | undefined> {
  return localDb.outbox.where('draftId').equals(draftId).first();
}

import { localDb, OutboxEntry } from '@/lib/localDb';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
const STUCK_DELAY_MS = Number.MAX_SAFE_INTEGER;

export async function enqueueSync(draftId: string, ownerUserId: string): Promise<void> {
  // Transaction keeps the read+write atomic: without it, two concurrent
  // calls for the same draftId could both see "no existing entry" and
  // create duplicate outbox rows.
  await localDb.transaction('rw', localDb.outbox, async () => {
    const existing = await getEntryForDraft(draftId, ownerUserId);
    if (existing) {
      await localDb.outbox.update(existing.id!, { nextAttemptAt: Date.now() });
      return;
    }
    await localDb.outbox.add({
      draftId,
      ownerUserId,
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
    });
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

/** Due entries for the given owner only — never drains another owner's outbox. */
export async function dueEntries(ownerUserId: string): Promise<OutboxEntry[]> {
  const now = Date.now();
  return localDb.outbox
    .filter((e) => e.ownerUserId === ownerUserId && e.nextAttemptAt <= now)
    .toArray();
}

export async function getEntryForDraft(
  draftId: string,
  ownerUserId?: string,
): Promise<OutboxEntry | undefined> {
  const entry = await localDb.outbox.where('draftId').equals(draftId).first();
  if (!entry) return undefined;
  if (ownerUserId !== undefined && entry.ownerUserId !== ownerUserId) return undefined;
  return entry;
}
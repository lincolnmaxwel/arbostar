import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { localDb } from '@/lib/localDb';
import {
  enqueueSync,
  nextBackoffDelay,
  recordFailure,
  markStuck,
  retryStuckEntry,
  clearEntry,
  dueEntries,
  getEntryForDraft,
} from '@/lib/outbox';

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

describe('outbox', () => {
  beforeEach(async () => {
    await localDb.outbox.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dedupes enqueue calls for the same draftId', async () => {
    await enqueueSync('draft-1', OWNER_A);
    await enqueueSync('draft-1', OWNER_A);
    const rows = await localDb.outbox.where('draftId').equals('draft-1').toArray();
    expect(rows).toHaveLength(1);
  });

  it('computes exponential backoff capped at 60s', () => {
    expect(nextBackoffDelay(0)).toBe(1000);
    expect(nextBackoffDelay(1)).toBe(2000);
    expect(nextBackoffDelay(6)).toBe(60000);
    expect(nextBackoffDelay(10)).toBe(60000);
  });

  it('recordFailure increments attempts and reschedules', async () => {
    await enqueueSync('draft-2', OWNER_A);
    const entry = await getEntryForDraft('draft-2');
    await recordFailure(entry!.id!, 'network error');
    const updated = await getEntryForDraft('draft-2');
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBe('network error');
    expect(updated!.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('markStuck stops the entry from being due, retryStuckEntry re-arms it', async () => {
    await enqueueSync('draft-3', OWNER_A);
    const entry = await getEntryForDraft('draft-3');
    await markStuck(entry!.id!, 'conflict');
    expect(await dueEntries(OWNER_A)).toHaveLength(0);
    await retryStuckEntry(entry!.id!);
    expect(await dueEntries(OWNER_A)).toHaveLength(1);
  });

  it('clearEntry removes the row', async () => {
    await enqueueSync('draft-4', OWNER_A);
    const entry = await getEntryForDraft('draft-4');
    await clearEntry(entry!.id!);
    expect(await getEntryForDraft('draft-4')).toBeUndefined();
  });

  it('stores the owner on the entry and never drains another owner\'s outbox', async () => {
    await enqueueSync('draft-a1', OWNER_A);
    await enqueueSync('draft-b1', OWNER_B);

    const dueForA = await dueEntries(OWNER_A);
    expect(dueForA.map((e) => e.draftId)).toEqual(['draft-a1']);

    const dueForB = await dueEntries(OWNER_B);
    expect(dueForB.map((e) => e.draftId)).toEqual(['draft-b1']);
  });

  it('getEntryForDraft hides entries belonging to another owner', async () => {
    await enqueueSync('draft-x', OWNER_B);
    expect(await getEntryForDraft('draft-x', OWNER_A)).toBeUndefined();
    expect(await getEntryForDraft('draft-x', OWNER_B)).toBeDefined();
  });
});
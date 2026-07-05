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

describe('outbox', () => {
  beforeEach(async () => {
    await localDb.outbox.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dedupes enqueue calls for the same draftId', async () => {
    await enqueueSync('draft-1');
    await enqueueSync('draft-1');
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
    await enqueueSync('draft-2');
    const entry = await getEntryForDraft('draft-2');
    await recordFailure(entry!.id!, 'network error');
    const updated = await getEntryForDraft('draft-2');
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBe('network error');
    expect(updated!.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('markStuck stops the entry from being due, retryStuckEntry re-arms it', async () => {
    await enqueueSync('draft-3');
    const entry = await getEntryForDraft('draft-3');
    await markStuck(entry!.id!, 'conflict');
    expect(await dueEntries()).toHaveLength(0);
    await retryStuckEntry(entry!.id!);
    expect(await dueEntries()).toHaveLength(1);
  });

  it('clearEntry removes the row', async () => {
    await enqueueSync('draft-4');
    const entry = await getEntryForDraft('draft-4');
    await clearEntry(entry!.id!);
    expect(await getEntryForDraft('draft-4')).toBeUndefined();
  });
});

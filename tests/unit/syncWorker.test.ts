// tests/unit/syncWorker.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft } from '@/lib/outbox';
import { runSyncCycle } from '@/lib/syncWorker';

describe('runSyncCycle', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
  });

  it('syncs a due draft successfully and clears the outbox entry', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d1');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // /api/health HEAD
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ quote: { id: 'server-1', items: [] } }) }); // POST

    await runSyncCycle();

    const draft = await localDb.drafts.get('d1');
    expect(draft?.status).toBe('synced');
    expect(draft?.serverId).toBe('server-1');
    expect(await getEntryForDraft('d1')).toBeUndefined();
  });

  it('marks the draft as error and stops retrying on a 409 conflict', async () => {
    await localDb.drafts.put({
      draftId: 'd2', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d2');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 409 });

    await runSyncCycle();

    const draft = await localDb.drafts.get('d2');
    expect(draft?.status).toBe('error');
    const entry = await getEntryForDraft('d2');
    expect(entry?.nextAttemptAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('reschedules with backoff on a network error, without marking the draft as error', async () => {
    await localDb.drafts.put({
      draftId: 'd3', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d3');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValueOnce(new Error('network down'));

    await runSyncCycle();

    const draft = await localDb.drafts.get('d3');
    expect(draft?.status).toBe('syncing');
    const entry = await getEntryForDraft('d3');
    expect(entry?.attempts).toBe(1);
    expect(entry!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(entry!.nextAttemptAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('does nothing when the health check fails (offline)', async () => {
    await localDb.drafts.put({
      draftId: 'd4', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d4');

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('offline'));

    await runSyncCycle();

    const draft = await localDb.drafts.get('d4');
    expect(draft?.status).toBe('syncing');
    expect(await getEntryForDraft('d4')).toBeDefined();
  });
});

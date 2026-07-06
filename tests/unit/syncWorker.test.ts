// tests/unit/syncWorker.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft } from '@/lib/outbox';
import { runSyncCycle } from '@/lib/syncWorker';

// runSyncCycle also health-checks and pulls the server's quote list every
// cycle (for cross-device sync), in addition to POSTing due outbox entries —
// so tests route by URL/method instead of a fixed positional call sequence.
function mockFetch({
  health = true,
  pull = { quotes: [] },
  post,
}: {
  health?: boolean;
  pull?: unknown;
  post?: (body: any) => { ok: boolean; status: number; json?: () => Promise<any> };
}) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    if (url === '/api/health') {
      return { ok: health, status: health ? 200 : 503 };
    }
    if (url === '/api/quotes' && (!opts || !opts.method)) {
      return { ok: true, json: async () => pull };
    }
    if (url === '/api/quotes' && opts?.method === 'POST') {
      const body = JSON.parse(opts.body as string);
      return post!(body);
    }
    throw new Error(`unexpected fetch: ${url} ${opts?.method ?? 'GET'}`);
  });
}

describe('runSyncCycle', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
    await localDb.pendingDeletes.clear();
  });

  it('syncs a due draft successfully and clears the outbox entry', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d1');

    global.fetch = mockFetch({
      post: () => ({ ok: true, status: 201, json: async () => ({ quote: { id: 'server-1', items: [] } }) }),
    }) as any;

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

    global.fetch = mockFetch({ post: () => ({ ok: false, status: 409 }) }) as any;

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

    global.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/api/health') return { ok: true, status: 200 };
      if (url === '/api/quotes' && (!opts || !opts.method)) return { ok: true, json: async () => ({ quotes: [] }) };
      if (url === '/api/quotes' && opts?.method === 'POST') throw new Error('network down');
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    await runSyncCycle();

    const draft = await localDb.drafts.get('d3');
    expect(draft?.status).toBe('syncing');
    const entry = await getEntryForDraft('d3');
    expect(entry?.attempts).toBe(1);
    expect(entry!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(entry!.nextAttemptAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('sends pendingSend:true as send:true in the POST body, then clears it on success', async () => {
    await localDb.drafts.put({
      draftId: 'd5', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(), pendingSend: true,
    });
    await enqueueSync('d5');

    let capturedBody: any;
    global.fetch = mockFetch({
      post: (body) => {
        capturedBody = body;
        return { ok: true, status: 200, json: async () => ({ quote: { id: 'server-5', items: [] } }) };
      },
    }) as any;

    await runSyncCycle();

    expect(capturedBody.send).toBe(true);

    const draft = await localDb.drafts.get('d5');
    expect(draft?.pendingSend).toBe(false);
  });

  it('sends send:false when pendingSend was never set', async () => {
    await localDb.drafts.put({
      draftId: 'd6', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d6');

    let capturedBody: any;
    global.fetch = mockFetch({
      post: (body) => {
        capturedBody = body;
        return { ok: true, status: 200, json: async () => ({ quote: { id: 'server-6', items: [] } }) };
      },
    }) as any;

    await runSyncCycle();

    expect(capturedBody.send).toBe(false);
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

  it('pulls and applies another device\'s edit within the same cycle', async () => {
    await localDb.drafts.put({
      draftId: 'd7', serverId: 'server-7', clientName: 'Old Name', clientEmail: 'a@x.com',
      taxRate: 0.05, status: 'synced', updatedAt: Date.now() - 60_000, items: [],
    });

    global.fetch = mockFetch({
      pull: {
        quotes: [{
          id: 'server-7', draftId: 'd7', client: { name: 'New Name', email: 'a@x.com' },
          taxRate: '0.05', items: [], updatedAt: new Date().toISOString(),
        }],
      },
    }) as any;

    await runSyncCycle();

    const draft = await localDb.drafts.get('d7');
    expect(draft?.clientName).toBe('New Name');
  });
});

// tests/unit/syncWorker.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft } from '@/lib/outbox';
import { runSyncCycle } from '@/lib/syncWorker';

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

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

function putDraft(overrides: Record<string, unknown>) {
  return localDb.drafts.put({
    draftId: 'd1',
    ownerUserId: OWNER_A,
    clientName: 'A',
    clientEmail: 'a@x.com',
    items: [],
    taxRate: 0.05,
    status: 'syncing',
    updatedAt: Date.now(),
    ...overrides,
  });
}

describe('runSyncCycle', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
    await localDb.pendingDeletes.clear();
    await localDb.photos.clear();
  });

  it('syncs a due draft successfully and clears the outbox entry', async () => {
    await putDraft({ draftId: 'd1' });
    await enqueueSync('d1', OWNER_A);

    global.fetch = mockFetch({
      post: () => ({ ok: true, status: 201, json: async () => ({ quote: { id: 'server-1', items: [] } }) }),
    }) as any;

    await runSyncCycle(OWNER_A);

    const draft = await localDb.drafts.get('d1');
    expect(draft?.status).toBe('synced');
    expect(draft?.serverId).toBe('server-1');
    expect(await getEntryForDraft('d1')).toBeUndefined();
  });

  it('marks the draft as error and stops retrying on a 409 conflict', async () => {
    await putDraft({ draftId: 'd2' });
    await enqueueSync('d2', OWNER_A);

    global.fetch = mockFetch({ post: () => ({ ok: false, status: 409 }) }) as any;

    await runSyncCycle(OWNER_A);

    const draft = await localDb.drafts.get('d2');
    expect(draft?.status).toBe('error');
    const entry = await getEntryForDraft('d2');
    expect(entry?.nextAttemptAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('reschedules with backoff on a network error, without marking the draft as error', async () => {
    await putDraft({ draftId: 'd3' });
    await enqueueSync('d3', OWNER_A);

    global.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/api/health') return { ok: true, status: 200 };
      if (url === '/api/quotes' && (!opts || !opts.method)) return { ok: true, json: async () => ({ quotes: [] }) };
      if (url === '/api/quotes' && opts?.method === 'POST') throw new Error('network down');
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    await runSyncCycle(OWNER_A);

    const draft = await localDb.drafts.get('d3');
    expect(draft?.status).toBe('syncing');
    const entry = await getEntryForDraft('d3');
    expect(entry?.attempts).toBe(1);
    expect(entry!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(entry!.nextAttemptAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('sends pendingSend:true as send:true in the POST body, then clears it on success', async () => {
    await putDraft({ draftId: 'd5', pendingSend: true });
    await enqueueSync('d5', OWNER_A);

    let capturedBody: any;
    global.fetch = mockFetch({
      post: (body) => {
        capturedBody = body;
        return { ok: true, status: 200, json: async () => ({ quote: { id: 'server-5', items: [] } }) };
      },
    }) as any;

    await runSyncCycle(OWNER_A);

    expect(capturedBody.send).toBe(true);

    const draft = await localDb.drafts.get('d5');
    expect(draft?.pendingSend).toBe(false);
  });

  it('sends send:false when pendingSend was never set', async () => {
    await putDraft({ draftId: 'd6' });
    await enqueueSync('d6', OWNER_A);

    let capturedBody: any;
    global.fetch = mockFetch({
      post: (body) => {
        capturedBody = body;
        return { ok: true, status: 200, json: async () => ({ quote: { id: 'server-6', items: [] } }) };
      },
    }) as any;

    await runSyncCycle(OWNER_A);

    expect(capturedBody.send).toBe(false);
  });

  it('does nothing when the health check fails (offline)', async () => {
    await putDraft({ draftId: 'd4' });
    await enqueueSync('d4', OWNER_A);

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('offline'));

    await runSyncCycle(OWNER_A);

    const draft = await localDb.drafts.get('d4');
    expect(draft?.status).toBe('syncing');
    expect(await getEntryForDraft('d4')).toBeDefined();
  });

  it('syncs only the given owner\'s drafts and never another owner\'s outbox', async () => {
    await putDraft({ draftId: 'a-draft' });
    await enqueueSync('a-draft', OWNER_A);
    await localDb.drafts.put({
      draftId: 'b-draft',
      ownerUserId: OWNER_B,
      clientName: 'B',
      clientEmail: 'b@x.com',
      items: [],
      taxRate: 0.05,
      status: 'syncing',
      updatedAt: Date.now(),
    });
    await enqueueSync('b-draft', OWNER_B);

    const postedDraftIds: string[] = [];
    global.fetch = mockFetch({
      post: (body) => {
        postedDraftIds.push(body.draftId);
        return { ok: true, status: 200, json: async () => ({ quote: { id: `server-${body.draftId}`, items: [] } }) };
      },
    }) as any;

    await runSyncCycle(OWNER_A);

    expect(postedDraftIds).toEqual(['a-draft']);
    expect((await localDb.drafts.get('a-draft'))?.status).toBe('synced');
    // B's entry stays queued and unsynced.
    expect((await localDb.drafts.get('b-draft'))?.status).toBe('syncing');
    expect(await getEntryForDraft('b-draft')).toBeDefined();
  });

  it('retries a pending photo upload for an already-synced draft every cycle, not just once', async () => {
    // Previously photo upload only ran once, from a useEffect in
    // QuoteBuilderForm keyed on the draft's status transitioning to
    // 'synced' — if that one attempt didn't complete (tab closed, network
    // drop), nothing ever retried it. runSyncCycle now retries on every
    // cycle for every locally-synced draft, independent of whether the
    // builder form is even open.
    await putDraft({
      draftId: 'd8',
      serverId: 'server-8',
      status: 'synced',
      items: [{ id: 'item-8', serverItemId: 'server-item-8', title: 'Hedges', price: 100, photoIds: ['photo-8'] }],
    });
    await localDb.photos.add({ id: 'photo-8', draftId: 'd8', blob: new Blob(['x']), fileName: 'p.jpg', status: 'pending' });

    let photoUploadCalled = false;
    global.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/api/health') return { ok: true, status: 200 };
      if (url === '/api/quotes' && (!opts || !opts.method)) {
        // Must include this quote (matched by serverId) — otherwise
        // pullServerQuotes treats an empty list as "deleted on another
        // device" and removes the local draft (and its photos) before the
        // retry logic under test ever runs.
        return {
          ok: true,
          json: async () => ({
            quotes: [{
              id: 'server-8', draftId: 'd8', client: { name: 'A', email: 'a@x.com' },
              taxRate: '0.05', status: 'draft', bookingStatus: 'idle',
              items: [{ id: 'server-item-8', localItemId: 'item-8', title: 'Hedges', price: 100 }],
              updatedAt: new Date(0).toISOString(),
            }],
          }),
        };
      }
      if (url === '/api/quotes/photos') {
        photoUploadCalled = true;
        return { ok: true, status: 201 };
      }
      throw new Error(`unexpected fetch: ${url} ${opts?.method ?? 'GET'}`);
    }) as any;

    await runSyncCycle(OWNER_A);

    expect(photoUploadCalled).toBe(true);
    expect((await localDb.photos.get('photo-8'))?.status).toBe('uploaded');
  });

  it('pulls and applies another device\'s edit within the same cycle', async () => {
    await putDraft({
      draftId: 'd7',
      serverId: 'server-7',
      clientName: 'Old Name',
      status: 'synced',
      updatedAt: Date.now() - 60_000,
    });

    global.fetch = mockFetch({
      pull: {
        quotes: [{
          id: 'server-7', draftId: 'd7', client: { name: 'New Name', email: 'a@x.com' },
          taxRate: '0.05', items: [], updatedAt: new Date().toISOString(),
        }],
      },
    }) as any;

    await runSyncCycle(OWNER_A);

    const draft = await localDb.drafts.get('d7');
    expect(draft?.clientName).toBe('New Name');
  });
});
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft } from '@/lib/outbox';
import { deleteDraft } from '@/lib/deleteQuote';

describe('deleteDraft', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.photos.clear();
    await localDb.outbox.clear();
  });

  it('removes a never-synced local draft without calling the server', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'local', updatedAt: Date.now(),
      items: [{ id: 'item-1', title: 'Hedges', price: 100, photoIds: [] }],
    });

    global.fetch = vi.fn();
    const draft = await localDb.drafts.get('d1');
    await deleteDraft(draft!);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await localDb.drafts.get('d1')).toBeUndefined();
  });

  it('deletes the server-side quote when the draft has synced (has a serverId)', async () => {
    await localDb.drafts.put({
      draftId: 'd2', serverId: 'server-quote-2', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-2', serverItemId: 'server-item-2', title: 'Hedges', price: 100, photoIds: [] }],
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const draft = await localDb.drafts.get('d2');
    await deleteDraft(draft!);

    expect(global.fetch).toHaveBeenCalledWith('/api/quotes/server-quote-2', { method: 'DELETE' });
    expect(await localDb.drafts.get('d2')).toBeUndefined();
  });

  it('removes attached photo blobs and any pending outbox entry', async () => {
    await localDb.photos.add({ id: 'photo-1', draftId: 'd3', blob: new Blob(['x']), fileName: 'p.jpg', status: 'pending' });
    await localDb.drafts.put({
      draftId: 'd3', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'error', updatedAt: Date.now(),
      items: [{ id: 'item-3', title: 'Hedges', price: 100, photoIds: ['photo-1'] }],
    });
    await enqueueSync('d3');

    global.fetch = vi.fn();
    const draft = await localDb.drafts.get('d3');
    await deleteDraft(draft!);

    expect(await localDb.photos.get('photo-1')).toBeUndefined();
    expect(await getEntryForDraft('d3')).toBeUndefined();
  });
});

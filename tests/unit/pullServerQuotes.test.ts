import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { pullServerQuotes } from '@/lib/pullServerQuotes';

function serverQuote(overrides: Partial<{
  id: string;
  draftId: string;
  clientName: string;
  price: string;
  updatedAt: string;
  localItemId: string;
}> = {}) {
  const {
    id = 'server-1',
    draftId = 'd1',
    clientName = 'A',
    price = '100',
    updatedAt = new Date().toISOString(),
    localItemId = 'item-1',
  } = overrides;
  return {
    id,
    draftId,
    client: { name: clientName, email: 'a@x.com' },
    taxRate: '0.05',
    items: [{ id: 'server-item-1', localItemId, title: 'Hedges', price }],
    updatedAt,
  };
}

describe('pullServerQuotes', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.pendingDeletes.clear();
  });

  it('inserts a quote this device has never seen', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quotes: [serverQuote()] }) });

    await pullServerQuotes();

    const draft = await localDb.drafts.get('d1');
    expect(draft?.clientName).toBe('A');
    expect(draft?.serverId).toBe('server-1');
    expect(draft?.status).toBe('synced');
  });

  it('does not clobber a local draft that has unsynced changes', async () => {
    await localDb.drafts.put({
      draftId: 'd1', serverId: 'server-1', clientName: 'Local Edit In Progress', clientEmail: 'a@x.com',
      taxRate: 0.05, status: 'local', updatedAt: Date.now(), items: [],
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ quotes: [serverQuote({ clientName: 'Stale Server Copy' })] }),
    });

    await pullServerQuotes();

    const draft = await localDb.drafts.get('d1');
    expect(draft?.clientName).toBe('Local Edit In Progress');
  });

  it('refreshes a fully-synced local draft when the server copy is newer', async () => {
    await localDb.drafts.put({
      draftId: 'd1', serverId: 'server-1', clientName: 'Old Name', clientEmail: 'a@x.com',
      taxRate: 0.05, status: 'synced', updatedAt: Date.now() - 60_000,
      items: [{ id: 'item-1', serverItemId: 'server-item-1', title: 'Hedges', price: 100, photoIds: ['photo-1'] }],
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ quotes: [serverQuote({ clientName: 'Edited On Other Device' })] }),
    });

    await pullServerQuotes();

    const draft = await localDb.drafts.get('d1');
    expect(draft?.clientName).toBe('Edited On Other Device');
    // Photos captured locally on this device must survive the refresh even
    // though the server response carries no photo data at all.
    expect(draft?.items[0].photoIds).toEqual(['photo-1']);
  });

  it('skips a quote queued for local deletion instead of resurrecting it', async () => {
    await localDb.pendingDeletes.put({ serverId: 'server-1', draftId: 'd1', createdAt: Date.now() });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quotes: [serverQuote()] }) });

    await pullServerQuotes();

    expect(await localDb.drafts.get('d1')).toBeUndefined();
  });

  it('removes a fully-synced draft that was deleted on another device', async () => {
    await localDb.photos.add({ id: 'photo-1', draftId: 'd1', blob: new Blob(['x']), fileName: 'p.jpg', status: 'uploaded' });
    await localDb.drafts.put({
      draftId: 'd1', serverId: 'server-1', clientName: 'Gone', clientEmail: 'a@x.com',
      taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-1', serverItemId: 'server-item-1', title: 'Hedges', price: 100, photoIds: ['photo-1'] }],
    });
    // Server list no longer contains server-1 -> it was deleted elsewhere.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quotes: [] }) });

    await pullServerQuotes();

    expect(await localDb.drafts.get('d1')).toBeUndefined();
    expect(await localDb.photos.get('photo-1')).toBeUndefined();
  });

  it('does not remove a local draft with unsynced changes even if absent from the server list', async () => {
    await localDb.drafts.put({
      draftId: 'd1', serverId: 'server-1', clientName: 'Still Editing', clientEmail: 'a@x.com',
      taxRate: 0.05, status: 'local', updatedAt: Date.now(), items: [],
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ quotes: [] }) });

    await pullServerQuotes();

    expect(await localDb.drafts.get('d1')).toBeDefined();
  });
});

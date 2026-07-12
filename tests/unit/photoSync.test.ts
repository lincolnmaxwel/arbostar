import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { addPhotoToItem, uploadPendingPhotos } from '@/lib/photoSync';

// Mirrors what QuoteBuilderForm does in production: addPhotoToItem only writes
// the blob to localDb.photos and returns its id; the caller is responsible for
// merging that id into the item's photoIds via its own draft-state update path.
async function attachPhoto(draftId: string, itemId: string, blob: Blob, fileName: string): Promise<string> {
  const photoId = await addPhotoToItem(draftId, blob, fileName);
  const draft = await localDb.drafts.get(draftId);
  if (!draft) throw new Error('draft not found');
  const items = draft.items.map((i) => (i.id === itemId ? { ...i, photoIds: [...i.photoIds, photoId] } : i));
  await localDb.drafts.put({ ...draft, items });
  return photoId;
}

describe('photoSync', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.photos.clear();
  });

  it('stores the photo locally, pending upload, without touching the draft directly', async () => {
    const blob = new Blob(['fake'], { type: 'image/jpeg' });

    const photoId = await addPhotoToItem('d1', blob, 'photo.jpg');

    const photo = await localDb.photos.get(photoId);
    expect(photo?.status).toBe('pending');
    expect(photo?.draftId).toBe('d1');
    // addPhotoToItem must not read/write localDb.drafts itself (that's what
    // caused a stale-read/overwrite race with the form's own debounced save).
    expect(await localDb.drafts.get('d1')).toBeUndefined();
  });

  it('skips items with no serverItemId yet', async () => {
    await localDb.drafts.put({
      draftId: 'd2', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'local', updatedAt: Date.now(),
      items: [{ id: 'item-2', title: 'Hedges', price: 100, photoIds: [] }],
    });
    await attachPhoto('d2', 'item-2', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn();
    await uploadPendingPhotos('d2');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uploads a pending photo once the item has a serverItemId, then marks it uploaded', async () => {
    await localDb.drafts.put({
      draftId: 'd3', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-3', serverItemId: 'server-item-3', title: 'Hedges', price: 100, photoIds: [] }],
    });
    await attachPhoto('d3', 'item-3', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await uploadPendingPhotos('d3');

    const draft = await localDb.drafts.get('d3');
    const photo = await localDb.photos.get(draft!.items[0].photoIds[0]);
    expect(photo?.status).toBe('uploaded');
  });

  it('retries a photo left stuck in a legacy "uploading" status from before this file stopped writing it', async () => {
    // Simulates a photo whose upload was interrupted (tab closed, app
    // backgrounded mid-request) under the old code, which persisted
    // 'uploading' to Dexie and never retried it. This file no longer writes
    // that status, but a real user's existing IndexedDB may still have one —
    // it must be picked back up, not skipped forever.
    await localDb.drafts.put({
      draftId: 'd-stuck', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-stuck', serverItemId: 'server-item-stuck', title: 'Hedges', price: 100, photoIds: [] }],
    });
    const photoId = await attachPhoto('d-stuck', 'item-stuck', new Blob(['x']), 'p.jpg');
    await localDb.photos.update(photoId, { status: 'uploading' });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await uploadPendingPhotos('d-stuck');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const photo = await localDb.photos.get(photoId);
    expect(photo?.status).toBe('uploaded');
  });

  it('leaves the photo pending (not stuck) so the next call retries it, after a failed upload', async () => {
    await localDb.drafts.put({
      draftId: 'd-retry', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-retry', serverItemId: 'server-item-retry', title: 'Hedges', price: 100, photoIds: [] }],
    });
    const photoId = await attachPhoto('d-retry', 'item-retry', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('network down'));
    await uploadPendingPhotos('d-retry');
    expect((await localDb.photos.get(photoId))?.status).toBe('pending');

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await uploadPendingPhotos('d-retry');
    expect((await localDb.photos.get(photoId))?.status).toBe('uploaded');
  });

  it('does not double-upload when called twice concurrently for the same draft (React StrictMode double-invoke)', async () => {
    await localDb.drafts.put({
      draftId: 'd4', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-4', serverItemId: 'server-item-4', title: 'Hedges', price: 100, photoIds: [] }],
    });
    await attachPhoto('d4', 'item-4', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    const p1 = uploadPendingPhotos('d4');
    const p2 = uploadPendingPhotos('d4');
    await Promise.all([p1, p2]);

    expect(global.fetch).toHaveBeenCalledTimes(1);

    const draft = await localDb.drafts.get('d4');
    const photo = await localDb.photos.get(draft!.items[0].photoIds[0]);
    expect(photo?.status).toBe('uploaded');
  });
});

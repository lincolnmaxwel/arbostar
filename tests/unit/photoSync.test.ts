import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { addPhotoToItem, uploadPendingPhotos } from '@/lib/photoSync';

describe('photoSync', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.photos.clear();
  });

  it('stores the photo locally and links it to the item, pending upload', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'local', updatedAt: Date.now(),
      items: [{ id: 'item-1', title: 'Hedges', price: 100, photoIds: [] }],
    });
    const blob = new Blob(['fake'], { type: 'image/jpeg' });

    await addPhotoToItem('d1', 'item-1', blob, 'photo.jpg');

    const draft = await localDb.drafts.get('d1');
    expect(draft?.items[0].photoIds).toHaveLength(1);
    const photoId = draft!.items[0].photoIds[0];
    const photo = await localDb.photos.get(photoId);
    expect(photo?.status).toBe('pending');
  });

  it('skips items with no serverItemId yet', async () => {
    await localDb.drafts.put({
      draftId: 'd2', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'local', updatedAt: Date.now(),
      items: [{ id: 'item-2', title: 'Hedges', price: 100, photoIds: [] }],
    });
    await addPhotoToItem('d2', 'item-2', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn();
    await uploadPendingPhotos('d2');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uploads a pending photo once the item has a serverItemId, then marks it uploaded', async () => {
    await localDb.drafts.put({
      draftId: 'd3', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-3', serverItemId: 'server-item-3', title: 'Hedges', price: 100, photoIds: [] }],
    });
    await addPhotoToItem('d3', 'item-3', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await uploadPendingPhotos('d3');

    const draft = await localDb.drafts.get('d3');
    const photo = await localDb.photos.get(draft!.items[0].photoIds[0]);
    expect(photo?.status).toBe('uploaded');
  });
});

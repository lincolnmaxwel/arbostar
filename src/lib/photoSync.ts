import { localDb } from '@/lib/localDb';

export async function addPhotoToItem(draftId: string, itemId: string, blob: Blob, fileName: string): Promise<void> {
  const photoId = crypto.randomUUID();
  await localDb.photos.add({ id: photoId, draftId, blob, fileName, status: 'pending' });

  const draft = await localDb.drafts.get(draftId);
  if (!draft) return;
  const items = draft.items.map((i) => (i.id === itemId ? { ...i, photoIds: [...i.photoIds, photoId] } : i));
  await localDb.drafts.put({ ...draft, items, updatedAt: Date.now() });
}

export async function uploadPendingPhotos(draftId: string): Promise<void> {
  const draft = await localDb.drafts.get(draftId);
  if (!draft) return;

  for (const item of draft.items) {
    if (!item.serverItemId) continue;
    for (const photoId of item.photoIds) {
      const photo = await localDb.photos.get(photoId);
      if (!photo || photo.status === 'uploaded') continue;

      const form = new FormData();
      form.set('quoteItemId', item.serverItemId);
      form.set('file', photo.blob, photo.fileName);
      try {
        const res = await fetch('/api/quotes/photos', { method: 'POST', body: form });
        if (res.ok) {
          await localDb.photos.update(photoId, { status: 'uploaded' });
        }
      } catch {
        // network error: photo stays 'pending', retried on the next call
      }
    }
  }
}

import { localDb } from '@/lib/localDb';
import type { DraftPhoto } from '@/lib/localDb';

export async function addPhotoToItem(draftId: string, blob: Blob, fileName: string): Promise<string> {
  const photoId = crypto.randomUUID();
  await localDb.photos.add({ id: photoId, draftId, blob, fileName, status: 'pending' });

  // Deliberately does NOT read-modify-write localDb.drafts here: the quote
  // builder form holds the authoritative draft snapshot in React state and
  // owns writing it to Dexie (debounced). If this function also read/wrote
  // localDb.drafts directly, its read could race a not-yet-persisted field
  // edit and revert it, or a later debounced write (built from the form's
  // state, which doesn't know about this photoId yet) could overwrite this
  // photo's photoIds entry right back out. The caller merges the returned
  // photoId into its own state and lets the normal save path persist it.
  return photoId;
}

export async function uploadPendingPhotos(draftId: string): Promise<void> {
  const draft = await localDb.drafts.get(draftId);
  if (!draft) return;

  for (const item of draft.items) {
    if (!item.serverItemId) continue;
    for (const photoId of item.photoIds) {
      // Atomically claim the photo for upload: the read-check-write happens inside a
      // single readwrite transaction, so two concurrent calls (e.g. React StrictMode's
      // double-invoked effect) can't both observe 'pending' before either write lands.
      // IndexedDB serializes readwrite transactions on the same store, so the second
      // call's transaction only runs after the first has committed the 'uploading' status.
      const claimedPhoto: DraftPhoto | null = await localDb.transaction('rw', localDb.photos, async () => {
        const current = await localDb.photos.get(photoId);
        if (!current || current.status === 'uploaded' || current.status === 'uploading') return null;
        await localDb.photos.update(photoId, { status: 'uploading' });
        return current;
      });
      if (!claimedPhoto) continue;

      const form = new FormData();
      form.set('quoteItemId', item.serverItemId);
      form.set('file', claimedPhoto.blob, claimedPhoto.fileName);

      try {
        const res = await fetch('/api/quotes/photos', { method: 'POST', body: form });
        if (res.ok) {
          await localDb.photos.update(photoId, { status: 'uploaded' });
        } else {
          await localDb.photos.update(photoId, { status: 'pending' });
        }
      } catch {
        // network error: revert to 'pending' so it's retried on the next call
        await localDb.photos.update(photoId, { status: 'pending' });
      }
    }
  }
}

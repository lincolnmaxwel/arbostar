import { localDb } from '@/lib/localDb';

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

// Guards against double-upload within THIS page load only (e.g. React
// StrictMode double-invoking the effect that kicks this off) — deliberately
// in-memory, not persisted to Dexie as an 'uploading' status. An earlier
// version persisted 'uploading' and treated it as un-retryable, which meant
// a photo whose upload was interrupted (tab closed, app backgrounded mid-
// request, a dropped connection that didn't reject cleanly) got stuck
// there forever: nothing ever put it back to 'pending', and every future
// call skipped it on sight. Since this set resets on every reload, a photo
// can always be retried on the next sync cycle no matter how the previous
// attempt died.
const inFlight = new Set<string>();

export async function uploadPendingPhotos(draftId: string): Promise<void> {
  const draft = await localDb.drafts.get(draftId);
  if (!draft) return;

  for (const item of draft.items) {
    if (!item.serverItemId) continue;
    for (const photoId of item.photoIds) {
      // Claimed synchronously, before any await, so two concurrent calls
      // (e.g. React StrictMode's double-invoked effect) can't both pass this
      // check for the same photoId — the second sees it already claimed.
      if (inFlight.has(photoId)) continue;
      inFlight.add(photoId);

      try {
        const photo = await localDb.photos.get(photoId);
        // Anything other than 'uploaded' is retryable — this also covers a
        // legacy 'uploading' row left over from before this file stopped
        // writing that status, self-healing a photo that got stuck under the
        // old logic the next time this runs.
        if (!photo || photo.status === 'uploaded') continue;

        const form = new FormData();
        form.set('quoteItemId', item.serverItemId);
        form.set('file', photo.blob, photo.fileName);

        const res = await fetch('/api/quotes/photos', { method: 'POST', body: form });
        if (res.ok) {
          await localDb.photos.update(photoId, { status: 'uploaded' });
        }
        // A non-ok response leaves status at 'pending' — retried next cycle.
      } catch {
        // network error — leave at 'pending', retried next cycle.
      } finally {
        inFlight.delete(photoId);
      }
    }
  }
}

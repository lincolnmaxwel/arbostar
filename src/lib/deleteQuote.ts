import { localDb, DraftQuote } from '@/lib/localDb';
import { getEntryForDraft, clearEntry } from '@/lib/outbox';
import { queuePendingDelete, flushPendingDeletes } from '@/lib/pendingDeletes';

export async function deleteDraft(draft: DraftQuote): Promise<void> {
  // Delete locally first and unconditionally — offline, the DELETE fetch
  // below can't succeed, and previously this whole function threw on that
  // fetch (unhandled rejection) before ever touching Dexie, so an offline
  // delete silently did nothing at all: not deleted locally, not queued.
  const photoIds = draft.items.flatMap((item) => item.photoIds);
  if (photoIds.length > 0) {
    await localDb.photos.bulkDelete(photoIds);
  }

  const entry = await getEntryForDraft(draft.draftId);
  if (entry) {
    await clearEntry(entry.id!);
  }

  await localDb.drafts.delete(draft.draftId);

  if (draft.serverId) {
    // Queued (not deleted immediately inline) so pullServerQuotes() can
    // check this table and skip re-inserting the quote while the server
    // delete is still in flight or retrying. flushPendingDeletes() is called
    // right away so the common online case still deletes immediately.
    await queuePendingDelete(draft.serverId, draft.draftId);
    await flushPendingDeletes();
  }
}

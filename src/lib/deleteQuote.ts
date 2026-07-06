import { localDb, DraftQuote } from '@/lib/localDb';
import { getEntryForDraft, clearEntry } from '@/lib/outbox';
import { queuePendingDelete, flushPendingDeletes } from '@/lib/pendingDeletes';

export async function deleteDraft(draft: DraftQuote): Promise<void> {
  const entry = await getEntryForDraft(draft.draftId);
  if (entry) {
    await clearEntry(entry.id!);
  }

  if (!draft.serverId) {
    // Never synced — nothing server-side to tell, so there's nothing to wait
    // for either. Remove it outright.
    const photoIds = draft.items.flatMap((item) => item.photoIds);
    if (photoIds.length > 0) {
      await localDb.photos.bulkDelete(photoIds);
    }
    await localDb.drafts.delete(draft.draftId);
    return;
  }

  // Already synced: mark it pending-delete rather than removing it outright,
  // so the Quotes list can show "queued for deletion" (with a Cancel option)
  // instead of the row just vanishing on a device that turns out to be
  // offline. flushPendingDeletes() actually removes the row once the
  // server confirms the delete — immediately, in the common online case.
  await localDb.drafts.update(draft.draftId, { pendingDelete: true });
  await queuePendingDelete(draft.serverId, draft.draftId);
  await flushPendingDeletes();
}

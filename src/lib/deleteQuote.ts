import { localDb, DraftQuote } from '@/lib/localDb';
import { getEntryForDraft, clearEntry } from '@/lib/outbox';

export async function deleteDraft(draft: DraftQuote): Promise<void> {
  if (draft.serverId) {
    await fetch(`/api/quotes/${draft.serverId}`, { method: 'DELETE' });
  }

  const photoIds = draft.items.flatMap((item) => item.photoIds);
  if (photoIds.length > 0) {
    await localDb.photos.bulkDelete(photoIds);
  }

  const entry = await getEntryForDraft(draft.draftId);
  if (entry) {
    await clearEntry(entry.id!);
  }

  await localDb.drafts.delete(draft.draftId);
}

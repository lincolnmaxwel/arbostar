import Dexie, { Table } from 'dexie';

export interface DraftQuoteItem {
  id: string;
  serverItemId?: string;
  title: string;
  description?: string;
  price: number;
  photoIds: string[];
}

export interface DraftQuote {
  draftId: string;
  serverId?: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  clientAddress?: string;
  // Where the work happens — distinct from clientAddress (the client's own
  // contact address), since the same client can request quotes for
  // different properties.
  serviceAddress?: string;
  items: DraftQuoteItem[];
  taxRate: number;
  status: 'local' | 'syncing' | 'synced' | 'error';
  updatedAt: number;
  // One-shot signal for the next sync POST: true means "Save and Send" was
  // clicked and this sync should tell the server to email the client. The
  // sync worker clears it back to false once that specific POST completes.
  pendingSend?: boolean;
  // Set while a delete is queued in `pendingDeletes` but hasn't flushed to
  // the server yet (offline, or the DELETE request failed). The draft row
  // stays visible — with this flag — instead of vanishing immediately, so
  // the Quotes list can show "pending deletion" and offer Cancel; the row is
  // only actually removed once flushPendingDeletes() confirms the server
  // copy is gone.
  pendingDelete?: boolean;
}

export interface DraftPhoto {
  id: string;
  draftId: string;
  blob: Blob;
  fileName: string;
  status: 'pending' | 'uploading' | 'uploaded';
}

export interface OutboxEntry {
  id?: number;
  draftId: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
  createdAt: number;
}

// A quote that was deleted locally while offline (or the DELETE request
// itself failed) but had already synced to the server at least once, so the
// server still has to be told. Kept separate from `outbox` (which is for
// pushing edits) because pullServerQuotes() needs to check this table too —
// otherwise it would re-insert the quote from the server on the very next
// pull, resurrecting something the user just deleted.
export interface PendingDelete {
  serverId: string;
  draftId: string;
  createdAt: number;
}

class LocalDb extends Dexie {
  drafts!: Table<DraftQuote, string>;
  photos!: Table<DraftPhoto, string>;
  outbox!: Table<OutboxEntry, number>;
  pendingDeletes!: Table<PendingDelete, string>;

  constructor() {
    super('arbostar');
    this.version(1).stores({
      drafts: 'draftId, status, updatedAt',
      photos: 'id, draftId',
      outbox: '++id, draftId, nextAttemptAt',
    });
    this.version(2).stores({
      pendingDeletes: 'serverId, draftId',
    });
  }
}

export const localDb = new LocalDb();

import Dexie, { Table } from 'dexie';
import { ApprovalStatus, BookingStatus } from '@/lib/quoteStatusLabel';

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
  // Effective owner of this local draft — the user whose server data it
  // belongs to (the real user normally; the viewed user while an admin
  // browses in view-as mode). Legacy pre-isolation rows carry '' until the
  // first authenticated load claims them for the current owner.
  ownerUserId: string;
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
  // The quote's business status server-side — where it stands with the
  // client (pending approval, approved, declined, pending scheduling,
  // scheduled) — as of the last successful sync/pull. Distinct from `status`
  // above, which only tracks whether THIS DEVICE's copy has reached the
  // server. Undefined until the first successful sync.
  approvalStatus?: ApprovalStatus;
  bookingStatus?: BookingStatus;
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
  ownerUserId: string;
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
  ownerUserId: string;
  createdAt: number;
}

// A timesheet entry logged on this device that has not reached the server yet
// (typically because there was no signal). `localId` doubles as the server's
// idempotency key (TimesheetEntry.clientEntryId), so a retry can never create
// a duplicate entry.
export interface PendingTimesheetEntry {
  localId: string;
  ownerUserId: string;
  clientId: string;
  clientName: string;
  workDate: string; // YYYY-MM-DD
  startedAt: string; // ISO
  endedAt: string; // ISO
  description: string;
  products: { name: string; quantity: number; unitPrice: number; billingType?: 'quantity' | 'hourly'; unit?: string | null }[];
  // 'pending' = waiting for a connection / next retry; 'error' = the server
  // rejected it (validation, client gone, feature off) and it needs the user.
  status: 'pending' | 'error';
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
  createdAt: number;
}

// A client created on this device while offline (from the Timesheet form).
// Its id is a real UUID the server accepts as the client's id, so pending
// timesheet entries can reference it before it exists server-side.
export interface PendingClient {
  id: string;
  ownerUserId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  status: 'pending' | 'error';
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
  createdAt: number;
}

class LocalDb extends Dexie {
  drafts!: Table<DraftQuote, string>;
  photos!: Table<DraftPhoto, string>;
  outbox!: Table<OutboxEntry, number>;
  pendingDeletes!: Table<PendingDelete, string>;
  timesheetPending!: Table<PendingTimesheetEntry, string>;
  clientsPending!: Table<PendingClient, string>;

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
    this.version(5).stores({
      drafts: 'draftId, status, updatedAt, ownerUserId',
      photos: 'id, draftId',
      outbox: '++id, draftId, nextAttemptAt, ownerUserId',
      pendingDeletes: 'serverId, draftId, ownerUserId',
      timesheetPending: 'localId, ownerUserId, status',
      clientsPending: 'id, ownerUserId, status',
    });
    this.version(4).stores({
      drafts: 'draftId, status, updatedAt, ownerUserId',
      photos: 'id, draftId',
      outbox: '++id, draftId, nextAttemptAt, ownerUserId',
      pendingDeletes: 'serverId, draftId, ownerUserId',
      timesheetPending: 'localId, ownerUserId, status',
    });
    this.version(3)
      .stores({
        drafts: 'draftId, status, updatedAt, ownerUserId',
        photos: 'id, draftId',
        outbox: '++id, draftId, nextAttemptAt, ownerUserId',
        pendingDeletes: 'serverId, draftId, ownerUserId',
      })
      // Legacy pre-isolation rows have no owner. Mark them with '' instead
      // of guessing an owner inside the database migration — the first
      // authenticated load claims them for the current effective owner
      // (see clientUserContext.claimLegacyRows).
      .upgrade((tx) =>
        Promise.all([
          tx
            .table('drafts')
            .toCollection()
            .modify((d: DraftQuote) => {
              if (!d.ownerUserId) d.ownerUserId = '';
            }),
          tx
            .table('outbox')
            .toCollection()
            .modify((e: OutboxEntry) => {
              if (!e.ownerUserId) e.ownerUserId = '';
            }),
          tx
            .table('pendingDeletes')
            .toCollection()
            .modify((p: PendingDelete) => {
              if (!p.ownerUserId) p.ownerUserId = '';
            }),
        ]),
      );
  }
}

export const localDb = new LocalDb();
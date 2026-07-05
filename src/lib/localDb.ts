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
  items: DraftQuoteItem[];
  taxRate: number;
  status: 'local' | 'syncing' | 'synced' | 'error';
  updatedAt: number;
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

class LocalDb extends Dexie {
  drafts!: Table<DraftQuote, string>;
  photos!: Table<DraftPhoto, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor() {
    super('arbostar');
    this.version(1).stores({
      drafts: 'draftId, status, updatedAt',
      photos: 'id, draftId',
      outbox: '++id, draftId, nextAttemptAt',
    });
  }
}

export const localDb = new LocalDb();

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { deleteDraft } from '@/lib/deleteQuote';
import { cancelPendingDelete } from '@/lib/pendingDeletes';
import { pullServerQuotes } from '@/lib/pullServerQuotes';
import { NewQuoteLink } from '@/components/NewQuoteLink';
import styles from './quotes.module.css';

export default function QuotesListPage() {
  const drafts = useLiveQuery(() => localDb.drafts.orderBy('updatedAt').reverse().toArray(), []) ?? [];

  // This list is otherwise a pure IndexedDB view — a quote synced from another
  // device never appears here on its own. Pull the server's list on mount and
  // whenever connectivity returns, so quotes made elsewhere show up here too.
  useEffect(() => {
    pullServerQuotes();
    window.addEventListener('online', pullServerQuotes);
    return () => window.removeEventListener('online', pullServerQuotes);
  }, []);

  async function handleDelete(draft: (typeof drafts)[number]) {
    const label = draft.clientName || 'this quote';
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    await deleteDraft(draft);
  }

  async function handleCancelDelete(draft: (typeof drafts)[number]) {
    if (!draft.serverId) return;
    await cancelPendingDelete(draft.serverId, draft.draftId);
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Quotes</h1>
        <NewQuoteLink className={styles.newButton}>+ New quote</NewQuoteLink>
      </div>

      {drafts.length === 0 ? (
        <div className={styles.empty}>
          <p>No quotes yet.</p>
          <NewQuoteLink className={styles.newButton}>Create your first quote</NewQuoteLink>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Client</th>
              <th>Status</th>
              <th>Last updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.draftId} className={d.pendingDelete ? styles.pendingDeleteRow : ''}>
                <td>
                  <Link
                    href={d.serverId ? `/quotes/${d.draftId}` : `/quotes/new?draft=${d.draftId}`}
                    className={styles.clientName}
                  >
                    {d.clientName || 'Untitled'}
                  </Link>
                  {d.clientEmail && <div className={styles.clientEmail}>{d.clientEmail}</div>}
                </td>
                <td>
                  {d.pendingDelete ? (
                    <span className={styles.pendingDeleteBadge} data-testid="pending-delete-badge">
                      Queued for deletion
                    </span>
                  ) : (
                    <SyncStatusBadge status={d.status} />
                  )}
                </td>
                <td>{new Date(d.updatedAt).toLocaleDateString()}</td>
                <td>
                  {d.pendingDelete ? (
                    <button type="button" className={styles.cancelDeleteButton} onClick={() => handleCancelDelete(d)}>
                      Cancel
                    </button>
                  ) : (
                    <button type="button" className={styles.deleteButton} onClick={() => handleDelete(d)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

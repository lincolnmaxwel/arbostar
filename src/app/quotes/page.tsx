'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { deleteDraft } from '@/lib/deleteQuote';
import styles from './quotes.module.css';

export default function QuotesListPage() {
  const drafts = useLiveQuery(() => localDb.drafts.orderBy('updatedAt').reverse().toArray(), []) ?? [];

  async function handleDelete(draft: (typeof drafts)[number]) {
    const label = draft.clientName || 'this quote';
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    await deleteDraft(draft);
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Quotes</h1>
        <Link href="/quotes/new" className={styles.newButton}>+ New quote</Link>
      </div>

      {drafts.length === 0 ? (
        <div className={styles.empty}>
          <p>No quotes yet.</p>
          <Link href="/quotes/new" className={styles.newButton}>Create your first quote</Link>
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
              <tr key={d.draftId}>
                <td>
                  <Link href={`/quotes/${d.draftId}`} className={styles.clientName}>
                    {d.clientName || 'Untitled'}
                  </Link>
                  {d.clientEmail && <div className={styles.clientEmail}>{d.clientEmail}</div>}
                </td>
                <td><SyncStatusBadge status={d.status} /></td>
                <td>{new Date(d.updatedAt).toLocaleDateString()}</td>
                <td>
                  <button type="button" className={styles.deleteButton} onClick={() => handleDelete(d)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

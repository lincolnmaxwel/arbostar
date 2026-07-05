'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import styles from './quotes.module.css';

export default function QuotesListPage() {
  const drafts = useLiveQuery(() => localDb.drafts.orderBy('updatedAt').reverse().toArray(), []) ?? [];

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
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.draftId}>
                <td>
                  <Link href={`/quotes/new?draft=${d.draftId}`} className={styles.clientName}>
                    {d.clientName || 'Untitled'}
                  </Link>
                  {d.clientEmail && <div className={styles.clientEmail}>{d.clientEmail}</div>}
                </td>
                <td><SyncStatusBadge status={d.status} /></td>
                <td>{new Date(d.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

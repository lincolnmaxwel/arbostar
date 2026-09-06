'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { QuoteStatusBadge } from '@/components/QuoteStatusBadge';
import { getDraftDisplayStatus } from '@/lib/quoteStatusLabel';
import { deleteDraft } from '@/lib/deleteQuote';
import { cancelPendingDelete } from '@/lib/pendingDeletes';
import { pullServerQuotes } from '@/lib/pullServerQuotes';
import { NewQuoteLink } from '@/components/NewQuoteLink';
import { getViewContext } from '@/lib/clientUserContext';
import styles from './quotes.module.css';

export default function QuotesListPage() {
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [quotesEnabled, setQuotesEnabled] = useState<boolean | null>(null);
  const liveDrafts = useLiveQuery(
    () =>
      ownerUserId
        ? localDb.drafts
            .orderBy('updatedAt')
            .reverse()
            .filter((d) => d.ownerUserId === ownerUserId)
            .toArray()
        : [],
    [ownerUserId],
  );
  const allDrafts = useMemo(() => liveDrafts ?? [], [liveDrafts]);
  const [search, setSearch] = useState('');

  // Bootstrap the effective owner so the list is namespaced to the current
  // user (or viewed user while an admin is in view-as mode).
  useEffect(() => {
    let cancelled = false;
    getViewContext().then((ctx) => {
      if (!cancelled) {
        setOwnerUserId(ctx?.ownerUserId ?? null);
        setQuotesEnabled(ctx?.features.quotes ?? false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const drafts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allDrafts;
    return allDrafts.filter((d) => {
      const haystack = [d.clientName, d.clientPhone, d.clientEmail, d.clientAddress, d.serviceAddress, getDraftDisplayStatus(d)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allDrafts, search]);

  // This list is otherwise a pure IndexedDB view — a quote synced from another
  // device never appears here on its own. Pull the server's list on mount and
  // whenever connectivity returns, so quotes made elsewhere show up here too.
  useEffect(() => {
    if (!ownerUserId || quotesEnabled !== true) return;
    pullServerQuotes(ownerUserId);
    const onOnline = () => pullServerQuotes(ownerUserId);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [ownerUserId, quotesEnabled]);

  async function handleDelete(draft: (typeof drafts)[number]) {
    const label = draft.clientName || 'this quote';
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    await deleteDraft(draft, ownerUserId!);
  }

  async function handleCancelDelete(draft: (typeof drafts)[number]) {
    if (!draft.serverId) return;
    await cancelPendingDelete(draft.serverId, draft.draftId);
  }

  if (quotesEnabled === false) {
    return (
      <div>
        <div className={styles.header}>
          <h1 className={styles.title}>Quotes</h1>
        </div>
        <p className={styles.featureDisabled}>
          Quotes is not enabled for your account. Ask an administrator to enable it.
        </p>
      </div>
    );
  }

  if (quotesEnabled === null) return <p className={styles.loading}>Loading...</p>;

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Quotes</h1>
        <NewQuoteLink className={styles.newButton}>+ New quote</NewQuoteLink>
      </div>

      {allDrafts.length > 0 && (
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by name, phone, address, email, or status"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search quotes"
        />
      )}

      {allDrafts.length === 0 ? (
        <div className={styles.empty}>
          <p>No quotes yet.</p>
          <NewQuoteLink className={styles.newButton}>Create your first quote</NewQuoteLink>
        </div>
      ) : drafts.length === 0 ? (
        <div className={styles.empty}>
          <p>No quotes match &quot;{search}&quot;.</p>
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
                  ) : d.status === 'synced' ? (
                    // Once synced, what matters is the quote's business status
                    // (pending client approval, approved, pending scheduling,
                    // ...) — not the now-uninteresting fact that it's synced.
                    <QuoteStatusBadge approvalStatus={d.approvalStatus} bookingStatus={d.bookingStatus} />
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

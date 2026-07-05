'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';

export default function QuotesListPage() {
  const drafts = useLiveQuery(() => localDb.drafts.orderBy('updatedAt').reverse().toArray(), []) ?? [];

  return (
    <div>
      <Link href="/quotes/new">New quote</Link>
      <ul>
        {drafts.map((d) => (
          <li key={d.draftId}>
            {d.clientName || 'Untitled'} <SyncStatusBadge status={d.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

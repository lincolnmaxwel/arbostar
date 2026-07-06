'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { BookingForm } from '@/components/BookingForm';
import styles from './booking.module.css';

export default function BookingPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = params.draftId;
  const draft = useLiveQuery(() => localDb.drafts.get(draftId), [draftId]);
  const [serverId, setServerId] = useState<string | null>(null);

  useEffect(() => {
    if (draft?.serverId) setServerId(draft.serverId);
  }, [draft?.serverId]);

  if (!serverId) return <p className={styles.loading}>This quote must be synced before booking.</p>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Schedule this estimate</h1>
      <p className={styles.sub}>Propose up to 3 date options. The client picks one or asks for new dates.</p>
      <BookingForm serverId={serverId} draftId={draftId} />
    </div>
  );
}

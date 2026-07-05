'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { calculateTotals } from '@/lib/quoteMath';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import styles from './QuoteView.module.css';

export function QuoteView({ draftId }: { draftId: string }) {
  const draft = useLiveQuery(() => localDb.drafts.get(draftId), [draftId]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    const urlsToRevoke: string[] = [];

    (async () => {
      const map: Record<string, string> = {};
      for (const item of draft.items) {
        for (const photoId of item.photoIds) {
          const photo = await localDb.photos.get(photoId);
          if (photo) {
            const url = URL.createObjectURL(photo.blob);
            map[photoId] = url;
            urlsToRevoke.push(url);
          }
        }
      }
      if (!cancelled) setPhotoUrls(map);
    })();

    return () => {
      cancelled = true;
      urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draft?.items]);

  if (!draft) return <p className={styles.loading}>Loading...</p>;

  const totals = calculateTotals(draft.items, draft.taxRate);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div>
          <SyncStatusBadge status={draft.status} />
          <h1 className={styles.title}>Estimate</h1>
          <p className={styles.meta}>Last updated {new Date(draft.updatedAt).toLocaleString()}</p>
        </div>
        <Link href={`/quotes/new?draft=${draftId}`} className={styles.editButton}>Edit</Link>
      </div>

      <div className={styles.party}>
        <h2 className={styles.partyLabel}>To</h2>
        <p className={styles.partyName}>{draft.clientName || 'Untitled client'}</p>
        {draft.clientEmail && <p className={styles.partyLine}>{draft.clientEmail}</p>}
        {draft.clientPhone && <p className={styles.partyLine}>{draft.clientPhone}</p>}
        {draft.clientAddress && <p className={styles.partyLine}>{draft.clientAddress}</p>}
      </div>

      {draft.items.length === 0 ? (
        <p className={styles.emptyItems}>No services added yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Proposed work</th>
              <th className={styles.priceCol}>Price</th>
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className={styles.itemTitle}>{item.title || 'Untitled service'}</div>
                  {item.description && <div className={styles.itemDescription}>{item.description}</div>}
                  {item.photoIds.length > 0 && (
                    <div className={styles.photos}>
                      {item.photoIds.map(
                        (photoId) =>
                          photoUrls[photoId] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={photoId} src={photoUrls[photoId]} className={styles.photoThumb} alt="" />
                          ),
                      )}
                    </div>
                  )}
                </td>
                <td className={styles.priceCol}>${item.price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>Subtotal</span>
          <span>${totals.subtotal.toFixed(2)}</span>
        </div>
        <div className={styles.totalRow}>
          <span>Tax ({(draft.taxRate * 100).toFixed(1)}%)</span>
          <span>${totals.taxAmount.toFixed(2)}</span>
        </div>
        <div className={`${styles.totalRow} ${styles.grandTotal}`}>
          <span>Total</span>
          <span>${totals.total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

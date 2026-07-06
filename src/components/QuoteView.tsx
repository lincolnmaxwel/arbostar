'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { calculateTotals } from '@/lib/quoteMath';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import styles from './QuoteView.module.css';

type BookingStatus = 'idle' | 'proposed' | 'rejected' | 'confirmed';
type DayWindow = 'morning' | 'afternoon' | 'fullday';

interface ApprovalStatus {
  status: 'draft' | 'sent' | 'approved' | 'declined' | 'expired' | 'scheduled';
  publicToken: string;
}

interface BookingState {
  bookingStatus: BookingStatus;
  scheduledDate?: string | null;
  scheduledWindow?: DayWindow | null;
}

const APPROVAL_LABEL: Record<ApprovalStatus['status'], string> = {
  draft: 'Draft',
  sent: 'Pending client approval',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  scheduled: 'Scheduled',
};

const WINDOW_LABEL: Record<DayWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

export function QuoteView({ draftId }: { draftId: string }) {
  const draft = useLiveQuery(() => localDb.drafts.get(draftId), [draftId]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [openPhotoIndex, setOpenPhotoIndex] = useState<number | null>(null);
  const [approval, setApproval] = useState<ApprovalStatus | null>(null);
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [copied, setCopied] = useState(false);

  const serverId = draft?.serverId;

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    fetch(`/api/quotes/${serverId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.quote) {
          setApproval({ status: body.quote.status, publicToken: body.quote.publicToken });
          if (body.quote.status === 'approved' || body.quote.status === 'scheduled') {
            fetch(`/api/quotes/${serverId}/booking`)
              .then((res) => (res.ok ? res.json() : null))
              .then((b) => {
                if (!cancelled && b?.quote) {
                  setBooking({
                    bookingStatus: b.quote.bookingStatus,
                    scheduledDate: b.quote.scheduledDate ?? null,
                    scheduledWindow: b.quote.scheduledWindow ?? null,
                  });
                }
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  function copyClientLink() {
    if (!approval) return;
    const url = `${window.location.origin}/portal/${approval.publicToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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

  const allPhotos = (draft?.items ?? []).flatMap((item) =>
    item.photoIds
      .filter((photoId) => photoUrls[photoId])
      .map((photoId) => ({ photoId, url: photoUrls[photoId], itemTitle: item.title || 'Untitled service' })),
  );

  function closeGallery() {
    setOpenPhotoIndex(null);
  }

  function showPrev() {
    setOpenPhotoIndex((i) => (i === null ? i : (i - 1 + allPhotos.length) % allPhotos.length));
  }

  function showNext() {
    setOpenPhotoIndex((i) => (i === null ? i : (i + 1) % allPhotos.length));
  }

  useEffect(() => {
    if (openPhotoIndex === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeGallery();
      if (e.key === 'ArrowLeft') showPrev();
      if (e.key === 'ArrowRight') showNext();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPhotoIndex, allPhotos.length]);

  if (!draft) return <p className={styles.loading}>Loading...</p>;

  const totals = calculateTotals(draft.items, draft.taxRate);

  function openGalleryAt(photoId: string) {
    const index = allPhotos.findIndex((p) => p.photoId === photoId);
    if (index >= 0) setOpenPhotoIndex(index);
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div>
          <SyncStatusBadge status={draft.status} />
          {approval && (
            <span className={`${styles.approvalBadge} ${styles[approval.status]}`} data-testid="approval-badge">
              {APPROVAL_LABEL[approval.status]}
            </span>
          )}
          <h1 className={styles.title}>Estimate</h1>
          <p className={styles.meta}>Last updated {new Date(draft.updatedAt).toLocaleString()}</p>
        </div>
        <div className={styles.topBarActions}>
          {approval && (
            <button type="button" className={styles.copyLinkButton} onClick={copyClientLink}>
              {copied ? 'Link copied!' : 'Copy client link'}
            </button>
          )}
          <Link href={`/quotes/new?draft=${draftId}`} className={styles.editButton}>Edit</Link>
        </div>
      </div>

      {approval && booking && (approval.status === 'approved' || approval.status === 'scheduled') && (
        <div className={styles.bookingArea} data-testid="booking-area">
          {booking.bookingStatus === 'idle' && (
            <Link href={`/quotes/${draftId}/booking`} className={styles.bookingAction}>
              Schedule
            </Link>
          )}
          {booking.bookingStatus === 'proposed' && (
            <span className={styles.bookingPending}>Booking pending — awaiting client response.</span>
          )}
          {booking.bookingStatus === 'rejected' && (
            <Link href={`/quotes/${draftId}/booking`} className={styles.bookingAction}>
              Re-propose dates
            </Link>
          )}
          {booking.bookingStatus === 'confirmed' && booking.scheduledDate && booking.scheduledWindow && (
            <span className={styles.bookingConfirmed}>
              Scheduled: {new Date(booking.scheduledDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · {WINDOW_LABEL[booking.scheduledWindow]}
            </span>
          )}
        </div>
      )}

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
                            <button
                              key={photoId}
                              type="button"
                              className={styles.photoThumbButton}
                              onClick={() => openGalleryAt(photoId)}
                              aria-label={`View photo for ${item.title || 'this service'}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={photoUrls[photoId]} className={styles.photoThumb} alt="" />
                            </button>
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

      {openPhotoIndex !== null && allPhotos[openPhotoIndex] && (
        <div
          className={styles.lightboxBackdrop}
          data-testid="photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={closeGallery}
        >
          <button type="button" className={styles.lightboxClose} onClick={closeGallery} aria-label="Close">
            &times;
          </button>

          {allPhotos.length > 1 && (
            <button
              type="button"
              className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
              onClick={(e) => {
                e.stopPropagation();
                showPrev();
              }}
              aria-label="Previous photo"
            >
              &#8249;
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={allPhotos[openPhotoIndex].url}
            alt={allPhotos[openPhotoIndex].itemTitle}
            className={styles.lightboxImage}
            onClick={(e) => e.stopPropagation()}
          />

          {allPhotos.length > 1 && (
            <button
              type="button"
              className={`${styles.lightboxNav} ${styles.lightboxNext}`}
              onClick={(e) => {
                e.stopPropagation();
                showNext();
              }}
              aria-label="Next photo"
            >
              &#8250;
            </button>
          )}

          <div className={styles.lightboxCaption}>
            {allPhotos[openPhotoIndex].itemTitle}
            {allPhotos.length > 1 && ` — ${openPhotoIndex + 1} of ${allPhotos.length}`}
          </div>
        </div>
      )}
    </div>
  );
}

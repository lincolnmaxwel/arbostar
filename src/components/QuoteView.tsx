'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { calculateTotals, formatMoney } from '@/lib/quoteMath';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import styles from './QuoteView.module.css';

type BookingStatus = 'idle' | 'proposed' | 'rejected' | 'confirmed';
type DayWindow = 'morning' | 'afternoon' | 'fullday';

interface ApprovalStatus {
  status: 'draft' | 'sent' | 'approved' | 'declined' | 'expired' | 'scheduled' | 'completed';
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
  completed: 'Completed',
};

const WINDOW_LABEL: Record<DayWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

export function QuoteView({ draftId }: { draftId: string }) {
  const draft = useLiveQuery(() => localDb.drafts.get(draftId), [draftId]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // Server-side photos for each item, keyed by localItemId (== DraftQuoteItem.id)
  // — a fallback for when this device's IndexedDB never captured the photo
  // blob itself (it was taken on a different device/browser). Populated by
  // the same status-polling fetch below, since it's already hitting
  // GET /api/quotes/[id] on an interval.
  const [serverItemPhotos, setServerItemPhotos] = useState<Record<string, { id: string; filePath: string }[]>>({});
  const [openPhotoIndex, setOpenPhotoIndex] = useState<number | null>(null);
  const [approval, setApproval] = useState<ApprovalStatus | null>(null);
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [copied, setCopied] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const serverId = draft?.serverId;

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;

    // Polls every 5s (matching the background sync loop's cadence) rather
    // than fetching once — a client approving/declining or confirming a
    // booking date changes server-side state that this tab has no other way
    // of finding out about, so without polling this badge stays frozen at
    // whatever it was when the page first loaded until a manual reload.
    function loadStatus() {
      fetch(`/api/quotes/${serverId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (!cancelled && body?.quote) {
            setApproval({ status: body.quote.status, publicToken: body.quote.publicToken });
            if (Array.isArray(body.quote.items)) {
              const map: Record<string, { id: string; filePath: string }[]> = {};
              for (const item of body.quote.items) {
                map[item.localItemId] = item.photos ?? [];
              }
              setServerItemPhotos(map);
            }
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
    }

    loadStatus();
    const timer = setInterval(loadStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [serverId]);

  async function handleMarkCompleted() {
    if (!serverId) return;
    if (!window.confirm('Mark this job as completed? This generates an invoice and emails it to the client.')) return;
    setCompleting(true);
    setCompleteError(null);
    const res = await fetch(`/api/quotes/${serverId}/complete`, { method: 'POST' });
    setCompleting(false);
    if (!res.ok) {
      setCompleteError('Could not mark as completed.');
      return;
    }
    setApproval((a) => (a ? { ...a, status: 'completed' } : a));
  }

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

  // Prefers this device's own local blobs (instant, no network); only falls
  // back to the server's uploaded copies when a photoId doesn't resolve
  // locally — i.e. it was captured on a different device/browser and this
  // one never had the blob to begin with.
  function getItemPhotos(item: { id: string; photoIds: string[]; title: string }) {
    const localResolved = item.photoIds
      .filter((photoId) => photoUrls[photoId])
      .map((photoId) => ({ key: photoId, url: photoUrls[photoId] }));
    if (localResolved.length >= item.photoIds.length) return localResolved;

    const serverPhotos = serverItemPhotos[item.id] ?? [];
    if (serverPhotos.length > 0) return serverPhotos.map((p) => ({ key: p.id, url: p.filePath }));

    return localResolved;
  }

  const allPhotos = (draft?.items ?? []).flatMap((item) =>
    getItemPhotos(item).map((photo) => ({ photoId: photo.key, url: photo.url, itemTitle: item.title || 'Untitled service' })),
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
          {/* Once a quote is sent, the client may already be looking at (or have
              acted on) the copy the server has — editing it out from under
              them would be confusing at best. Only local/never-synced or
              still-draft quotes stay editable; !approval covers a never-synced
              local draft, which has no server-side status to check. */}
          {(!approval || approval.status === 'draft') && (
            <Link href={`/quotes/new?draft=${draftId}`} className={styles.editButton}>Edit</Link>
          )}
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
          {booking.bookingStatus === 'confirmed' && approval.status === 'scheduled' && (
            <button type="button" className={styles.bookingAction} onClick={handleMarkCompleted} disabled={completing}>
              {completing ? 'Marking completed...' : 'Mark job completed'}
            </button>
          )}
        </div>
      )}
      {completeError && <p className={styles.meta} role="alert">{completeError}</p>}

      <div className={styles.party}>
        <h2 className={styles.partyLabel}>To</h2>
        <p className={styles.partyName}>{draft.clientName || 'Untitled client'}</p>
        {draft.clientEmail && <p className={styles.partyLine}>{draft.clientEmail}</p>}
        {draft.clientPhone && <p className={styles.partyLine}>{draft.clientPhone}</p>}
        {draft.clientAddress && <p className={styles.partyLine}>{draft.clientAddress}</p>}
      </div>

      {draft.serviceAddress && (
        <div className={styles.party}>
          <h2 className={styles.partyLabel}>Service address</h2>
          <p className={styles.partyLine}>{draft.serviceAddress}</p>
        </div>
      )}

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
                  {getItemPhotos(item).length > 0 && (
                    <div className={styles.photos}>
                      {getItemPhotos(item).map((photo) => (
                        <button
                          key={photo.key}
                          type="button"
                          className={styles.photoThumbButton}
                          onClick={() => openGalleryAt(photo.key)}
                          aria-label={`View photo for ${item.title || 'this service'}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.url} className={styles.photoThumb} alt="" />
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td className={styles.priceCol}>{formatMoney(item.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>Subtotal</span>
          <span>{formatMoney(totals.subtotal)}</span>
        </div>
        <div className={styles.totalRow}>
          <span>Tax ({(draft.taxRate * 100).toFixed(1)}%)</span>
          <span>{formatMoney(totals.taxAmount)}</span>
        </div>
        <div className={`${styles.totalRow} ${styles.grandTotal}`}>
          <span>Total</span>
          <span>{formatMoney(totals.total)}</span>
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

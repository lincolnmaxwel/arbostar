'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/quoteMath';
import styles from '@/app/portal/[token]/portal.module.css';

export interface PortalItem {
  id: string;
  title: string;
  description: string | null;
  price: number;
  photos: { id: string; filePath: string }[];
}

export function PortalItemsTable({ items }: { items: PortalItem[] }) {
  const [openPhotoIndex, setOpenPhotoIndex] = useState<number | null>(null);

  const allPhotos = items.flatMap((item) =>
    item.photos.map((photo) => ({ photoId: photo.id, url: photo.filePath, itemTitle: item.title })),
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

  function openGalleryAt(photoId: string) {
    const index = allPhotos.findIndex((p) => p.photoId === photoId);
    if (index >= 0) setOpenPhotoIndex(index);
  }

  return (
    <>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Proposed work</th>
            <th className={styles.priceCol}>Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <div className={styles.itemTitle}>{item.title}</div>
                {item.description && <div className={styles.itemDescription}>{item.description}</div>}
                {item.photos.length > 0 && (
                  <div className={styles.photos}>
                    {item.photos.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        className={styles.photoThumbButton}
                        onClick={() => openGalleryAt(photo.id)}
                        aria-label={`View photo for ${item.title}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.filePath} className={styles.photoThumb} alt="" />
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
    </>
  );
}

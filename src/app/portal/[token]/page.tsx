import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PortalActions } from '@/components/PortalActions';
import { PortalItemsTable } from '@/components/PortalItemsTable';
import styles from './portal.module.css';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
};

export default async function PortalPage({ params }: { params: { token: string } }) {
  const quote = await prisma.quote.findUnique({
    where: { publicToken: params.token },
    include: {
      client: true,
      items: { orderBy: { sortOrder: 'asc' }, include: { photos: { orderBy: { sortOrder: 'asc' } } } },
    },
  });

  if (!quote) notFound();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.topBar}>
          <span className={`${styles.statusBadge} ${styles[quote.status]}`}>{STATUS_LABEL[quote.status]}</span>
          <div>
            <h1 className={styles.title}>Estimate #{quote.number}</h1>
            {quote.sentAt && <p className={styles.meta}>Sent {new Date(quote.sentAt).toLocaleDateString()}</p>}
          </div>
        </div>

        <div className={styles.party}>
          <h2 className={styles.partyLabel}>To</h2>
          <p className={styles.partyName}>{quote.client.name}</p>
          {quote.client.email && <p className={styles.partyLine}>{quote.client.email}</p>}
          {quote.client.phone && <p className={styles.partyLine}>{quote.client.phone}</p>}
          {quote.client.address && <p className={styles.partyLine}>{quote.client.address}</p>}
        </div>

        <PortalItemsTable
          items={quote.items.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            price: Number(item.price),
            photos: item.photos.map((photo) => ({ id: photo.id, filePath: photo.filePath })),
          }))}
        />

        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span>Subtotal</span>
            <span>${Number(quote.subtotal).toFixed(2)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>Tax ({(Number(quote.taxRate) * 100).toFixed(1)}%)</span>
            <span>${Number(quote.taxAmount).toFixed(2)}</span>
          </div>
          <div className={`${styles.totalRow} ${styles.grandTotal}`}>
            <span>Total</span>
            <span>${Number(quote.total).toFixed(2)}</span>
          </div>
        </div>

        <PortalActions token={params.token} status={quote.status} />
      </div>
    </div>
  );
}

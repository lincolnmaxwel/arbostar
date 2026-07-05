import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PortalActions } from '@/components/PortalActions';
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

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Proposed work</th>
              <th className={styles.priceCol}>Price</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className={styles.itemTitle}>{item.title}</div>
                  {item.description && <div className={styles.itemDescription}>{item.description}</div>}
                  {item.photos.length > 0 && (
                    <div className={styles.photos}>
                      {item.photos.map((photo) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={photo.id} src={photo.filePath} className={styles.photoThumb} alt="" />
                      ))}
                    </div>
                  )}
                </td>
                <td className={styles.priceCol}>${Number(item.price).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

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

import Link from 'next/link';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/quoteMath';
import { DeleteInvoiceButton } from '@/components/DeleteInvoiceButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import styles from './invoices.module.css';

// See src/app/clients/page.tsx for why this is required: a raw Prisma call
// doesn't signal "dynamic" to Next, so without this the list gets baked into
// a static page at build time and never picks up new invoices.
export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const invoices = await prisma.invoice.findMany({
    include: { quote: { include: { client: true } } },
    orderBy: { number: 'desc' },
  });

  return (
    <div>
      <AutoRefresh />
      <div className={styles.header}>
        <h1 className={styles.title}>Invoices</h1>
      </div>

      {invoices.length === 0 ? (
        <div className={styles.empty}>
          <p>No invoices yet — mark a scheduled job Completed to generate one.</p>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Sent</th>
              <th className={styles.priceCol}>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <Link href={`/invoices/${inv.id}`} className={styles.invoiceLink}>
                    #{inv.number}
                  </Link>
                </td>
                <td>
                  <div>{inv.quote.client.name}</div>
                  <div className={styles.clientEmail}>{inv.quote.client.email}</div>
                </td>
                <td>{inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : '—'}</td>
                <td className={styles.priceCol}>{formatMoney(Number(inv.total))}</td>
                <td className={styles.actionsCell}>
                  <a href={`/api/invoices/${inv.id}/pdf`} download className={styles.downloadButton}>
                    Download
                  </a>
                  <DeleteInvoiceButton invoiceId={inv.id} invoiceNumber={inv.number} className={styles.deleteButton} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

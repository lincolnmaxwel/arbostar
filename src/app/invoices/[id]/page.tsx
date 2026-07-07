import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/quoteMath';
import { getCompanyProfile, companyLogoUrl } from '@/lib/companyProfile';
import { DeleteInvoiceButton } from '@/components/DeleteInvoiceButton';
import styles from './invoice.module.css';

// Not strictly required (a dynamic route segment with no generateStaticParams
// already renders on demand), but explicit here for the same reason as the
// /clients and /invoices list pages: a raw Prisma call gives Next no
// "dynamic" signal on its own.
export const dynamic = 'force-dynamic';

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { quote: { include: { client: true, items: { orderBy: { sortOrder: 'asc' } } } } },
  });
  if (!invoice) notFound();

  const company = await getCompanyProfile();
  const logoUrl = companyLogoUrl(company.logoPath);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Invoice #{invoice.number}</h1>
            <p className={styles.meta}>Quote #{invoice.quote.number} · {invoice.sentAt ? new Date(invoice.sentAt).toLocaleDateString() : ''}</p>
          </div>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={company.name ?? 'Company logo'} className={styles.logo} />
          )}
        </div>

        <div className={styles.actions}>
          <DeleteInvoiceButton invoiceId={invoice.id} invoiceNumber={invoice.number} className={styles.deleteButton} redirectTo="/invoices" />
        </div>

        <div className={styles.parties}>
          <div className={styles.party}>
            <h2 className={styles.partyLabel}>To</h2>
            <p className={styles.partyName}>{invoice.quote.client.name}</p>
            {invoice.quote.client.email && <p className={styles.partyLine}>{invoice.quote.client.email}</p>}
            {invoice.quote.client.phone && <p className={styles.partyLine}>{invoice.quote.client.phone}</p>}
            {invoice.quote.client.address && <p className={styles.partyLine}>{invoice.quote.client.address}</p>}
            {invoice.quote.serviceAddress && <p className={styles.partyLine}>Service address: {invoice.quote.serviceAddress}</p>}
          </div>

          {(company.name || company.phone || company.email || company.address) && (
            <div className={styles.party}>
              <h2 className={styles.partyLabel}>From</h2>
              {company.name && <p className={styles.partyName}>{company.name}</p>}
              {company.phone && <p className={styles.partyLine}>{company.phone}</p>}
              {company.email && <p className={styles.partyLine}>{company.email}</p>}
              {company.address && <p className={styles.partyLine}>{company.address}</p>}
            </div>
          )}
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Description</th>
              <th className={styles.priceCol}>Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.quote.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className={styles.itemTitle}>{item.title}</div>
                  {item.description && <div className={styles.itemDescription}>{item.description}</div>}
                </td>
                <td className={styles.priceCol}>{formatMoney(Number(item.price))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span>Subtotal</span>
            <span>{formatMoney(Number(invoice.subtotal))}</span>
          </div>
          <div className={styles.totalRow}>
            <span>Tax ({(Number(invoice.taxRate) * 100).toFixed(1)}%)</span>
            <span>{formatMoney(Number(invoice.taxAmount))}</span>
          </div>
          <div className={`${styles.totalRow} ${styles.grandTotal}`}>
            <span>Total</span>
            <span>{formatMoney(Number(invoice.total))}</span>
          </div>
        </div>

        <p className={styles.thanks}>Thank you for your business{company.name ? ` with ${company.name}` : ''}!</p>
      </div>
    </div>
  );
}

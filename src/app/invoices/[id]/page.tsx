import { notFound } from 'next/navigation';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled } from '@/lib/features';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/quoteMath';
import { getCompanyProfile, companyLogoUrl } from '@/lib/companyProfile';
import { DeleteInvoiceButton } from '@/components/DeleteInvoiceButton';
import { PaymentStatusBadge } from '@/components/PaymentStatusBadge';
import { MarkPaidButton } from '@/components/MarkPaidButton';
import styles from './invoice.module.css';

// Not strictly required (a dynamic route segment with no generateStaticParams
// already renders on demand), but explicit here for the same reason as the
// /clients and /invoices list pages: a raw Prisma call gives Next no
// "dynamic" signal on its own.
export const dynamic = 'force-dynamic';

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) return null;
    throw err;
  }

  if (!(await isFeatureEnabled(scope.ownerUserId, 'invoices'))) {
    return <p className={styles.featureDisabled}>This feature is not enabled for your account.</p>;
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
    include: {
      client: true,
      quote: { include: { client: true, items: { orderBy: { sortOrder: 'asc' } } } },
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!invoice) notFound();

  const company = await getCompanyProfile(invoice.userId);
  const logoUrl = companyLogoUrl(company.logoPath);

  const isTimesheet = invoice.source === 'timesheet';
  const items =
    invoice.source === 'timesheet'
      ? invoice.lineItems.map((l) => ({
          id: l.id,
          title: l.description,
          description: null,
          amount: Number(l.amount),
        }))
      : (invoice.quote?.items.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          amount: Number(item.price),
        })) ?? []);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Invoice #{invoice.number}</h1>
            <p className={styles.meta}>
              {invoice.quote ? `Quote #${invoice.quote.number} · ` : ''}
              {invoice.sentAt ? new Date(invoice.sentAt).toLocaleDateString() : ''}
            </p>
            <div className={styles.paymentRow}>
              <PaymentStatusBadge status={invoice.paymentStatus} />
            </div>
          </div>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={company.name ?? 'Company logo'} className={styles.logo} />
          )}
        </div>

        <div className={styles.actions}>
          <MarkPaidButton invoiceId={invoice.id} invoiceNumber={invoice.number} paymentStatus={invoice.paymentStatus} className={styles.markPaidButton} />
          {!isTimesheet && (
            <DeleteInvoiceButton invoiceId={invoice.id} invoiceNumber={invoice.number} className={styles.deleteButton} redirectTo="/invoices" />
          )}
        </div>

        <div className={styles.parties}>
          <div className={styles.party}>
            <h2 className={styles.partyLabel}>To</h2>
            <p className={styles.partyName}>{invoice.client.name}</p>
            {invoice.client.email && <p className={styles.partyLine}>{invoice.client.email}</p>}
            {invoice.client.phone && <p className={styles.partyLine}>{invoice.client.phone}</p>}
            {invoice.client.address && <p className={styles.partyLine}>{invoice.client.address}</p>}
            {invoice.serviceAddress && <p className={styles.partyLine}>Service address: {invoice.serviceAddress}</p>}
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
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className={styles.itemTitle}>{item.title}</div>
                  {item.description && <div className={styles.itemDescription}>{item.description}</div>}
                </td>
                <td className={styles.priceCol}>{formatMoney(item.amount)}</td>
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
        <p className={styles.terms}>
          Terms: Payments can be made by e-transfer{company.email ? ` to ${company.email}` : ''}, by cheque, or by credit card. Please
          state invoice or estimate # on your payment. Receipt not valid until cheque has cleared bank. Interest will be applied at
          2% per month on accounts outstanding more than 30 days.
        </p>
      </div>
    </div>
  );
}
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/quoteMath';
import { getPaymentStatusLabel, InvoicePaymentStatus } from '@/lib/paymentStatusLabel';
import { PaymentStatusBadge } from '@/components/PaymentStatusBadge';
import { MarkPaidButton } from '@/components/MarkPaidButton';
import { DeleteInvoiceButton } from '@/components/DeleteInvoiceButton';
import styles from '@/app/invoices/invoices.module.css';

interface InvoiceRow {
  id: string;
  number: number;
  clientName: string;
  clientEmail: string;
  sentAt: string | null;
  total: number;
  paymentStatus: InvoicePaymentStatus;
}

export function InvoiceListClient({ invoices }: { invoices: InvoiceRow[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const haystack = [`#${inv.number}`, inv.clientName, inv.clientEmail, getPaymentStatusLabel(inv.paymentStatus)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [invoices, search]);

  return (
    <>
      {invoices.length > 0 && (
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by invoice #, client, or payment status"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search invoices"
        />
      )}

      {invoices.length === 0 ? (
        <div className={styles.empty}>
          <p>No invoices yet — mark a scheduled job Completed to generate one.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>No invoices match &quot;{search}&quot;.</p>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Sent</th>
              <th>Payment</th>
              <th className={styles.priceCol}>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <Link href={`/invoices/${inv.id}`} className={styles.invoiceLink}>
                    #{inv.number}
                  </Link>
                </td>
                <td>
                  <div>{inv.clientName}</div>
                  <div className={styles.clientEmail}>{inv.clientEmail}</div>
                </td>
                <td>{inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : '—'}</td>
                <td>
                  <PaymentStatusBadge status={inv.paymentStatus} />
                </td>
                <td className={styles.priceCol}>{formatMoney(inv.total)}</td>
                <td className={styles.actionsCell}>
                  <a href={`/api/invoices/${inv.id}/pdf`} download className={styles.downloadButton}>
                    Download
                  </a>
                  <MarkPaidButton invoiceId={inv.id} paymentStatus={inv.paymentStatus} className={styles.downloadButton} />
                  <DeleteInvoiceButton invoiceId={inv.id} invoiceNumber={inv.number} className={styles.deleteButton} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/quoteMath';
import { getPaymentStatusLabel } from '@/lib/paymentStatusLabel';
import { PaymentStatusBadge } from '@/components/PaymentStatusBadge';
import { DEMO_GST_RATE, formatDay, type DemoInvoice } from '@/lib/demoData';
import listStyles from '@/app/invoices/invoices.module.css';
import viewStyles from '@/components/QuoteView.module.css';
import styles from './demo.module.css';
import type { DemoScreenProps } from './demoTypes';

export function DemoInvoices(props: DemoScreenProps) {
  const invoice = props.nav.id ? props.data.invoices.find((i) => i.id === props.nav.id) : undefined;
  if (invoice) return <InvoiceDetail {...props} invoice={invoice} />;
  return <InvoiceList {...props} />;
}

function InvoiceList({ data, update, go, toast }: DemoScreenProps) {
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const sorted = [...data.invoices].sort((a, b) => b.number - a.number);
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((i) =>
      [`#${i.number}`, i.clientName, i.clientEmail, getPaymentStatusLabel(i.paymentStatus), i.source].join(' ').toLowerCase().includes(q),
    );
  }, [data.invoices, search]);

  function togglePaid(inv: DemoInvoice) {
    const paid = inv.paymentStatus !== 'paid';
    update((d) => ({ ...d, invoices: d.invoices.map((i) => (i.id === inv.id ? { ...i, paymentStatus: paid ? 'paid' : 'pending' } : i)) }));
    toast(paid ? `Invoice #${inv.number} marked as paid. In the real app a receipt is emailed to the client.` : `Invoice #${inv.number} is pending again.`);
  }

  return (
    <div>
      <div className={listStyles.header}>
        <h1 className={listStyles.title}>Invoices</h1>
      </div>

      <p className={styles.hint}>Invoices appear here when you complete a job or generate one from the timesheet. Try marking one as paid.</p>

      <input
        type="search"
        className={listStyles.searchInput}
        placeholder="Search by invoice #, client, or payment status"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search invoices"
      />

      {rows.length === 0 ? (
        <div className={listStyles.empty}>
          <p>{data.invoices.length === 0 ? 'No invoices yet — mark a scheduled job Completed or generate a timesheet invoice.' : `No invoices match "${search}".`}</p>
        </div>
      ) : (
        <table className={listStyles.table}>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Sent</th>
              <th>Payment</th>
              <th className={listStyles.priceCol}>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <button type="button" className={`${styles.linkButton} ${listStyles.invoiceLink}`} onClick={() => go('invoices', inv.id)}>
                    #{inv.number}
                  </button>
                  <span className={`${listStyles.sourceBadge} ${inv.source === 'timesheet' ? listStyles.sourceBadgeTimesheet : listStyles.sourceBadgeQuote}`}>
                    {inv.source === 'timesheet' ? 'Timesheet' : `Quote #${inv.quoteNumber}`}
                  </span>
                </td>
                <td>
                  <div>{inv.clientName}</div>
                  {inv.clientEmail && <div className={listStyles.clientEmail}>{inv.clientEmail}</div>}
                </td>
                <td>{formatDay(inv.date)}</td>
                <td>
                  <PaymentStatusBadge status={inv.paymentStatus} />
                </td>
                <td className={listStyles.priceCol}>{formatMoney(inv.total)}</td>
                <td className={listStyles.actionsCell}>
                  <button type="button" className={listStyles.downloadButton} onClick={() => toast('In the real app this downloads the invoice as a PDF with your logo and GST number.')}>
                    Download
                  </button>
                  <button type="button" className={listStyles.downloadButton} onClick={() => togglePaid(inv)}>
                    {inv.paymentStatus === 'paid' ? 'Mark unpaid' : 'Mark paid'}
                  </button>
                  {inv.source !== 'timesheet' && (
                    <button
                      type="button"
                      className={listStyles.deleteButton}
                      onClick={() => {
                        update((d) => ({ ...d, invoices: d.invoices.filter((i) => i.id !== inv.id) }));
                        toast(`Invoice #${inv.number} deleted (demo only).`);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function InvoiceDetail({ invoice, update, go, toast }: DemoScreenProps & { invoice: DemoInvoice }) {
  function togglePaid() {
    const paid = invoice.paymentStatus !== 'paid';
    update((d) => ({ ...d, invoices: d.invoices.map((i) => (i.id === invoice.id ? { ...i, paymentStatus: paid ? 'paid' : 'pending' } : i)) }));
    toast(paid ? 'Marked as paid. In the real app a receipt is emailed to the client.' : 'Marked as pending again.');
  }

  return (
    <div className={viewStyles.page}>
      <button type="button" className={styles.backButton} onClick={() => go('invoices')}>
        &larr; All invoices
      </button>

      <div className={viewStyles.topBar}>
        <div>
          <PaymentStatusBadge status={invoice.paymentStatus} />
          <h1 className={viewStyles.title}>Invoice #{invoice.number}</h1>
          <p className={viewStyles.meta}>Issued {formatDay(invoice.date)}</p>
        </div>
        <div className={viewStyles.topBarActions}>
          <button type="button" className={viewStyles.copyLinkButton} onClick={() => toast('In the real app this downloads the invoice as a PDF.')}>
            Download PDF
          </button>
          <button type="button" className={viewStyles.sendButton} onClick={togglePaid}>
            {invoice.paymentStatus === 'paid' ? 'Mark unpaid' : 'Mark paid'}
          </button>
        </div>
      </div>

      <div className={viewStyles.party}>
        <h2 className={viewStyles.partyLabel}>From</h2>
        <p className={viewStyles.partyName}>Evergreen Tree Care Ltd.</p>
        <p className={viewStyles.partyLine}>hello@evergreen-trees.example.com &middot; (604) 555-0100</p>
        <p className={viewStyles.partyLine}>GST #: 123456789 RT0001</p>
      </div>

      <div className={viewStyles.party}>
        <h2 className={viewStyles.partyLabel}>Bill to</h2>
        <p className={viewStyles.partyName}>{invoice.clientName}</p>
        {invoice.clientEmail && <p className={viewStyles.partyLine}>{invoice.clientEmail}</p>}
      </div>

      <table className={viewStyles.table}>
        <thead>
          <tr>
            <th>Description</th>
            <th className={viewStyles.priceCol}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, i) => (
            <tr key={i}>
              <td>
                <div className={viewStyles.itemTitle}>{line.title}</div>
                {line.description && <div className={viewStyles.itemDescription}>{line.description}</div>}
              </td>
              <td className={viewStyles.priceCol}>{formatMoney(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={viewStyles.totals}>
        <div className={viewStyles.totalRow}>
          <span>Subtotal</span>
          <span>{formatMoney(invoice.subtotal)}</span>
        </div>
        <div className={viewStyles.totalRow}>
          <span>GST ({(DEMO_GST_RATE * 100).toFixed(1)}%)</span>
          <span>{formatMoney(invoice.tax)}</span>
        </div>
        <div className={`${viewStyles.totalRow} ${viewStyles.grandTotal}`}>
          <span>Total</span>
          <span>{formatMoney(invoice.total)}</span>
        </div>
      </div>
    </div>
  );
}

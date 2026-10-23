'use client';

import { useMemo, useState } from 'react';
import { QuoteStatusBadge } from '@/components/QuoteStatusBadge';
import { getQuoteStatusLabel } from '@/lib/quoteStatusLabel';
import { formatMoney } from '@/lib/quoteMath';
import {
  DEMO_GST_RATE,
  formatDay,
  addDays,
  invoiceFromQuote,
  nextQuoteNumber,
  quoteTotals,
  uid,
  type DemoClient,
  type DemoQuote,
  type DemoQuoteItem,
} from '@/lib/demoData';
import listStyles from '@/app/quotes/quotes.module.css';
import viewStyles from '@/components/QuoteView.module.css';
import formStyles from '@/components/QuoteBuilderForm.module.css';
import styles from './demo.module.css';
import type { DemoScreenProps } from './demoTypes';

export function DemoQuotes(props: DemoScreenProps) {
  const { nav } = props;
  if (nav.id === 'new') return <QuoteBuilder {...props} />;
  const quote = nav.id ? props.data.quotes.find((q) => q.id === nav.id) : undefined;
  if (nav.id && quote && nav.id.startsWith('edit:')) return <QuoteBuilder {...props} />;
  if (quote) return <QuoteDetail {...props} quote={quote} />;
  if (nav.id?.startsWith('edit:')) return <QuoteBuilder {...props} />;
  return <QuoteList {...props} />;
}

function QuoteList({ data, update, go, toast }: DemoScreenProps) {
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...data.quotes].sort((a, b) => (a.updatedAt === b.updatedAt ? b.number - a.number : a.updatedAt < b.updatedAt ? 1 : -1));
    if (!q) return sorted;
    return sorted.filter((quote) => {
      const status = getQuoteStatusLabel(quote.status, quote.booking).label;
      return [quote.clientName, quote.clientEmail, quote.clientPhone, quote.serviceAddress, status].join(' ').toLowerCase().includes(q);
    });
  }, [data.quotes, search]);

  function remove(quote: DemoQuote) {
    update((d) => ({ ...d, quotes: d.quotes.filter((q) => q.id !== quote.id) }));
    toast(`Quote #${quote.number} deleted (demo only).`);
  }

  return (
    <div>
      <div className={listStyles.header}>
        <h1 className={listStyles.title}>Quotes</h1>
        <button type="button" className={listStyles.newButton} onClick={() => go('quotes', 'new')}>
          + New quote
        </button>
      </div>

      <p className={styles.hint}>
        Open a quote to send it, approve it as the client would, schedule it and mark it completed to generate its invoice.
      </p>

      <input
        type="search"
        className={listStyles.searchInput}
        placeholder="Search by name, phone, address, email, or status"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search quotes"
      />

      {rows.length === 0 ? (
        <div className={listStyles.empty}>
          <p>{data.quotes.length === 0 ? 'No quotes yet.' : `No quotes match "${search}".`}</p>
        </div>
      ) : (
        <table className={listStyles.table}>
          <thead>
            <tr>
              <th>Client</th>
              <th>Status</th>
              <th>Last updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td>
                  <button type="button" className={`${styles.linkButton} ${listStyles.clientName}`} onClick={() => go('quotes', q.id)}>
                    {q.clientName || 'Untitled'}
                  </button>
                  {q.clientEmail && <div className={listStyles.clientEmail}>{q.clientEmail}</div>}
                </td>
                <td>
                  <QuoteStatusBadge approvalStatus={q.status} bookingStatus={q.booking} />
                </td>
                <td>{formatDay(q.updatedAt)}</td>
                <td>
                  <button type="button" className={listStyles.deleteButton} onClick={() => remove(q)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QuoteDetail({ quote, data, update, go, toast, today }: DemoScreenProps & { quote: DemoQuote }) {
  const [scheduling, setScheduling] = useState(false);
  const [date, setDate] = useState(addDays(today, 5));
  const [window, setWindow] = useState<'morning' | 'afternoon'>('morning');
  const totals = quoteTotals(quote.items);
  const invoice = data.invoices.find((i) => i.quoteNumber === quote.number);

  function patch(changes: Partial<DemoQuote>) {
    update((d) => ({ ...d, quotes: d.quotes.map((q) => (q.id === quote.id ? { ...q, ...changes, updatedAt: today } : q)) }));
  }

  function send() {
    patch({ status: 'sent' });
    toast('Quote sent. In the real app the client gets an email with a link to review it.');
  }

  function schedule() {
    update((d) => ({
      ...d,
      quotes: d.quotes.map((q) =>
        q.id === quote.id ? { ...q, status: 'scheduled', booking: 'confirmed', scheduledDate: date, scheduledWindow: window, updatedAt: today } : q,
      ),
      // A client shows up under Clients once one of their quotes is scheduled.
      clients: d.clients.some((c) => c.name.toLowerCase() === quote.clientName.toLowerCase())
        ? d.clients
        : [
            ...d.clients,
            { id: uid(), name: quote.clientName, email: quote.clientEmail, phone: quote.clientPhone, address: quote.serviceAddress },
          ],
    }));
    setScheduling(false);
    toast('Scheduled. In the real app the client confirms the date from their own link.');
  }

  function complete() {
    update((d) => ({
      ...d,
      quotes: d.quotes.map((q) => (q.id === quote.id ? { ...q, status: 'completed', updatedAt: today } : q)),
      invoices: [...d.invoices, invoiceFromQuote(quote, d.invoices, today)],
    }));
    toast('Job completed. The invoice was created automatically.');
  }

  return (
    <div className={viewStyles.page}>
      <button type="button" className={styles.backButton} onClick={() => go('quotes')}>
        &larr; All quotes
      </button>

      <div className={viewStyles.topBar}>
        <div>
          <QuoteStatusBadge approvalStatus={quote.status} bookingStatus={quote.booking} />
          <h1 className={viewStyles.title}>Estimate #{quote.number}</h1>
          <p className={viewStyles.meta}>Last updated {formatDay(quote.updatedAt)}</p>
        </div>
        <div className={viewStyles.topBarActions}>
          {quote.status === 'draft' && (
            <>
              <button type="button" className={viewStyles.sendButton} onClick={send}>
                Send
              </button>
              <button type="button" className={viewStyles.editButton} onClick={() => go('quotes', `edit:${quote.id}`)}>
                Edit
              </button>
            </>
          )}
          {quote.status === 'sent' && (
            <button type="button" className={viewStyles.copyLinkButton} onClick={() => toast('In the real app this copies the private link your client opens to approve.')}>
              Copy client link
            </button>
          )}
        </div>
      </div>

      {quote.status === 'sent' && (
        <div className={styles.hint}>
          Waiting for the client. In real life they approve from their email link - here you can play the client:
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className={styles.demoAction} onClick={() => { patch({ status: 'approved' }); toast('The client approved the quote.'); }}>
              Simulate: client approves
            </button>
            <button type="button" className={styles.demoAction} onClick={() => { patch({ status: 'declined' }); toast('The client declined the quote.'); }}>
              Simulate: client declines
            </button>
          </div>
        </div>
      )}

      {quote.status === 'approved' && (
        <div className={viewStyles.bookingArea}>
          {!scheduling ? (
            <button type="button" className={viewStyles.bookingAction} onClick={() => setScheduling(true)}>
              Schedule
            </button>
          ) : (
            <div className={styles.formGrid} style={{ width: '100%' }}>
              <div className={formStyles.field}>
                <label htmlFor="demo-sched-date">Date</label>
                <input id="demo-sched-date" type="date" className={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className={formStyles.field}>
                <label htmlFor="demo-sched-window">Time window</label>
                <select id="demo-sched-window" className={formStyles.input} value={window} onChange={(e) => setWindow(e.target.value as 'morning' | 'afternoon')}>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={viewStyles.bookingAction} onClick={schedule} disabled={!date}>
                  Confirm schedule
                </button>
                <button type="button" className={styles.rowButton} onClick={() => setScheduling(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {quote.status === 'scheduled' && quote.scheduledDate && (
        <div className={viewStyles.bookingArea}>
          <span className={viewStyles.bookingConfirmed}>
            Scheduled: {formatDay(quote.scheduledDate)} &middot; {quote.scheduledWindow === 'afternoon' ? 'Afternoon' : 'Morning'}
          </span>
          <button type="button" className={viewStyles.bookingAction} onClick={complete}>
            Mark job completed
          </button>
        </div>
      )}

      {quote.status === 'completed' && invoice && (
        <div className={viewStyles.bookingArea}>
          <span className={viewStyles.bookingConfirmed}>Job completed &middot; Invoice #{invoice.number} created</span>
          <button type="button" className={viewStyles.bookingAction} onClick={() => go('invoices', invoice.id)}>
            View invoice
          </button>
        </div>
      )}

      <div className={viewStyles.party}>
        <h2 className={viewStyles.partyLabel}>To</h2>
        <p className={viewStyles.partyName}>{quote.clientName || 'Untitled client'}</p>
        {quote.clientEmail && <p className={viewStyles.partyLine}>{quote.clientEmail}</p>}
        {quote.clientPhone && <p className={viewStyles.partyLine}>{quote.clientPhone}</p>}
      </div>

      {quote.serviceAddress && (
        <div className={viewStyles.party}>
          <h2 className={viewStyles.partyLabel}>Service address</h2>
          <p className={viewStyles.partyLine}>{quote.serviceAddress}</p>
        </div>
      )}

      {quote.items.length === 0 ? (
        <p className={viewStyles.emptyItems}>No services added yet.</p>
      ) : (
        <table className={viewStyles.table}>
          <thead>
            <tr>
              <th>Proposed work</th>
              <th className={viewStyles.priceCol}>Price</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className={viewStyles.itemTitle}>{item.title || 'Untitled service'}</div>
                  {item.description && <div className={viewStyles.itemDescription}>{item.description}</div>}
                </td>
                <td className={viewStyles.priceCol}>{formatMoney(item.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={viewStyles.totals}>
        <div className={viewStyles.totalRow}>
          <span>Subtotal</span>
          <span>{formatMoney(totals.subtotal)}</span>
        </div>
        <div className={viewStyles.totalRow}>
          <span>GST ({(DEMO_GST_RATE * 100).toFixed(1)}%)</span>
          <span>{formatMoney(totals.tax)}</span>
        </div>
        <div className={`${viewStyles.totalRow} ${viewStyles.grandTotal}`}>
          <span>Total</span>
          <span>{formatMoney(totals.total)}</span>
        </div>
      </div>
    </div>
  );
}

const blankItem = (): DemoQuoteItem => ({ id: uid(), title: '', description: '', price: 0 });

function QuoteBuilder({ nav, data, update, go, toast, today }: DemoScreenProps) {
  const editing = nav.id?.startsWith('edit:') ? data.quotes.find((q) => q.id === nav.id!.slice(5)) : undefined;
  const [name, setName] = useState(editing?.clientName ?? '');
  const [email, setEmail] = useState(editing?.clientEmail ?? '');
  const [phone, setPhone] = useState(editing?.clientPhone ?? '');
  const [address, setAddress] = useState(editing?.serviceAddress ?? '');
  const [items, setItems] = useState<DemoQuoteItem[]>(editing?.items.length ? editing.items : [blankItem()]);

  const totals = quoteTotals(items.map((i) => ({ price: Number(i.price) || 0 })));
  const canSave = name.trim().length > 0 && items.some((i) => i.title.trim());

  function pickClient(id: string) {
    const c: DemoClient | undefined = data.clients.find((x) => x.id === id);
    if (!c) return;
    setName(c.name);
    setEmail(c.email);
    setPhone(c.phone);
    setAddress(c.address);
  }

  function setItem(id: string, changes: Partial<DemoQuoteItem>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  }

  function save(send: boolean) {
    const cleaned = items.filter((i) => i.title.trim()).map((i) => ({ ...i, price: Number(i.price) || 0 }));
    const status = send ? 'sent' : (editing?.status ?? 'draft');
    let id = editing?.id;
    update((d) => {
      if (editing) {
        return {
          ...d,
          quotes: d.quotes.map((q) =>
            q.id === editing.id
              ? { ...q, clientName: name.trim(), clientEmail: email.trim(), clientPhone: phone.trim(), serviceAddress: address.trim(), items: cleaned, status, updatedAt: today }
              : q,
          ),
        };
      }
      id = uid();
      const quote: DemoQuote = {
        id,
        number: nextQuoteNumber(d.quotes),
        clientName: name.trim(),
        clientEmail: email.trim(),
        clientPhone: phone.trim(),
        serviceAddress: address.trim(),
        items: cleaned,
        status,
        booking: 'idle',
        scheduledDate: null,
        scheduledWindow: null,
        updatedAt: today,
      };
      return { ...d, quotes: [...d.quotes, quote] };
    });
    toast(send ? 'Quote sent. In the real app the client gets an email with a link to approve.' : 'Quote saved as a draft.');
    go('quotes', id);
  }

  return (
    <div>
      <button type="button" className={styles.backButton} onClick={() => go('quotes')}>
        &larr; All quotes
      </button>
      <div className={listStyles.header}>
        <h1 className={listStyles.title}>{editing ? `Edit quote #${editing.number}` : 'New quote'}</h1>
      </div>

      <form className={formStyles.form} onSubmit={(e) => e.preventDefault()}>
        <div className={formStyles.section}>
          <h2 className={formStyles.sectionTitle}>Client details</h2>
          {data.clients.length > 0 && !editing && (
            <div className={formStyles.field}>
              <label htmlFor="demo-existing-client">Existing client</label>
              <select id="demo-existing-client" className={formStyles.input} defaultValue="" onChange={(e) => pickClient(e.target.value)}>
                <option value="">Select a client to reuse their info...</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={formStyles.field}>
            <label htmlFor="demo-client-name">Client name</label>
            <input id="demo-client-name" className={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="demo-client-email">Client email</label>
            <input id="demo-client-email" type="email" className={formStyles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="demo-client-phone">Client phone</label>
            <input id="demo-client-phone" className={formStyles.input} placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="demo-service-address">Service address</label>
            <input id="demo-service-address" className={formStyles.input} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>

        <div className={formStyles.section}>
          <h2 className={formStyles.sectionTitle} style={{ margin: 0, border: 'none', padding: 0 }}>
            Services
          </h2>
          {items.map((item) => (
            <div key={item.id} className={formStyles.itemCard}>
              <div className={formStyles.itemCardHeader}>
                <button
                  type="button"
                  className={formStyles.removeItemButton}
                  onClick={() => setItems((list) => (list.length > 1 ? list.filter((i) => i.id !== item.id) : [blankItem()]))}
                >
                  Remove
                </button>
              </div>
              <div className={formStyles.itemCardFields}>
                <div className={`${formStyles.itemField} ${formStyles.itemFieldFull}`}>
                  <label htmlFor={`demo-title-${item.id}`}>Service title</label>
                  <input id={`demo-title-${item.id}`} className={formStyles.itemInput} value={item.title} onChange={(e) => setItem(item.id, { title: e.target.value })} />
                </div>
                <div className={`${formStyles.itemField} ${formStyles.itemFieldFull}`}>
                  <label htmlFor={`demo-desc-${item.id}`}>Description</label>
                  <textarea
                    id={`demo-desc-${item.id}`}
                    className={formStyles.itemInput}
                    rows={2}
                    value={item.description}
                    onChange={(e) => setItem(item.id, { description: e.target.value })}
                  />
                </div>
                <div className={formStyles.itemField}>
                  <label htmlFor={`demo-price-${item.id}`}>Price ($)</label>
                  <input
                    id={`demo-price-${item.id}`}
                    type="number"
                    min="0"
                    step="0.01"
                    className={formStyles.itemInput}
                    value={item.price === 0 ? '' : item.price}
                    onChange={(e) => setItem(item.id, { price: Number(e.target.value) })}
                  />
                </div>
                <div className={`${formStyles.itemField} ${formStyles.itemFieldFull}`}>
                  <label>Photo</label>
                  <button type="button" className={formStyles.photoButton} onClick={() => toast('Photos can be taken or picked from the gallery in the real app, even offline.')}>
                    Add photo
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className={formStyles.addItemRow}>
            <button type="button" className={formStyles.addItemButton} onClick={() => setItems((list) => [...list, blankItem()])}>
              + Add service
            </button>
          </div>
        </div>

        <div className={formStyles.totals}>
          <div className={formStyles.totalItem}>
            <div className={formStyles.totalItemLabel}>Subtotal</div>
            <div className={formStyles.totalItemValue}>{formatMoney(totals.subtotal)}</div>
          </div>
          <div className={formStyles.totalItem}>
            <div className={formStyles.totalItemLabel}>GST ({(DEMO_GST_RATE * 100).toFixed(1)}%)</div>
            <div className={formStyles.totalItemValue}>{formatMoney(totals.tax)}</div>
          </div>
          <div className={formStyles.totalItem}>
            <div className={formStyles.totalItemLabel}>Total</div>
            <div className={formStyles.totalItemValueGrand}>{formatMoney(totals.total)}</div>
          </div>
        </div>

        <div className={formStyles.actions}>
          <button type="button" className={formStyles.saveButton} onClick={() => save(false)} disabled={!canSave}>
            Save
          </button>
          <button type="button" className={formStyles.sendButton} onClick={() => save(true)} disabled={!canSave}>
            Save and Send
          </button>
          {!canSave && <p className={formStyles.sendHint}>Add a client name and at least one service with a title.</p>}
        </div>
      </form>
    </div>
  );
}

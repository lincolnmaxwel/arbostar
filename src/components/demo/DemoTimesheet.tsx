'use client';

import { useMemo, useState } from 'react';
import CatalogSearch from '@/components/CatalogSearch';
import { formatMoney } from '@/lib/quoteMath';
import {
  DEMO_HOURLY_RATE,
  entryHours,
  entryLabor,
  entrySubtotal,
  invoicesFromEntries,
  uid,
  formatDay,
  type DemoEntry,
  type DemoProduct,
} from '@/lib/demoData';
import styles from '@/app/timesheet/timesheet.module.css';
import type { DemoScreenProps } from './demoTypes';

export function DemoTimesheet({ data, update, today, go, toast }: DemoScreenProps) {
  const [form, setForm] = useState({ clientId: '', workDate: today, startTime: '08:00', endTime: '17:00', description: '' });
  const [products, setProducts] = useState<DemoProduct[]>([]);
  const [filterClient, setFilterClient] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? 'Client';

  const visible = useMemo(
    () =>
      data.entries
        .filter((e) => !filterClient || e.clientId === filterClient)
        .sort((a, b) => (a.workDate === b.workDate ? 0 : a.workDate < b.workDate ? 1 : -1)),
    [data.entries, filterClient],
  );
  const openVisible = visible.filter((e) => e.status === 'open');
  const selectedEntries = data.entries.filter((e) => selected.has(e.id) && e.status === 'open');
  const selectedClientCount = new Set(selectedEntries.map((e) => e.clientId)).size;
  const allSelected = openVisible.length > 0 && openVisible.every((e) => selected.has(e.id));

  function addProduct(serviceId?: string) {
    const s = serviceId ? data.services.find((x) => x.id === serviceId) : undefined;
    const hours = entryHours(form);
    setProducts((list) => [
      ...list,
      {
        id: uid(),
        name: s?.name ?? '',
        billingType: s?.billingType ?? 'quantity',
        unit: s?.unit ?? '',
        quantity: s?.billingType === 'hourly' ? Number(hours.toFixed(2)) || 1 : 1,
        unitPrice: s?.defaultPrice ?? 0,
      },
    ]);
  }

  function setProduct(id: string, changes: Partial<DemoProduct>) {
    setProducts((list) => list.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientId || !form.description.trim() || entryHours(form) <= 0) {
      toast('Pick a client, describe the work and use an end time after the start time.');
      return;
    }
    const entry: DemoEntry = {
      id: uid(),
      workDate: form.workDate || today,
      clientId: form.clientId,
      description: form.description.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      hourlyRate: DEMO_HOURLY_RATE,
      products: products.filter((p) => p.name.trim()),
      status: 'open',
    };
    update((d) => ({ ...d, entries: [entry, ...d.entries] }));
    setForm((f) => ({ ...f, description: '' }));
    setProducts([]);
    toast('Entry saved.');
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function generate() {
    if (selectedEntries.length === 0) return;
    update((d) => {
      const created = invoicesFromEntries(selectedEntries, d.clients, d.invoices, today);
      const ids = new Set(selectedEntries.map((e) => e.id));
      return {
        ...d,
        invoices: [...d.invoices, ...created],
        entries: d.entries.map((e) => (ids.has(e.id) ? { ...e, status: 'invoiced' } : e)),
      };
    });
    setSelected(new Set());
    toast(`${selectedClientCount === 1 ? 'Invoice' : 'Invoices'} generated. Find ${selectedClientCount === 1 ? 'it' : 'them'} under Invoices.`);
    go('invoices');
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Timesheet</h1>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>New entry</h2>
        <p className={styles.rateNotice}>
          Hourly rate: <span className={styles.rateValue}>{formatMoney(DEMO_HOURLY_RATE)}/hr</span> (set in your Profile).
        </p>

        <form onSubmit={save}>
          <div className={styles.entryForm}>
            <div className={styles.field}>
              <label htmlFor="demo-ts-client">Client</label>
              <select id="demo-ts-client" className={styles.input} value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                <option value="">Select a client...</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="demo-ts-date">Work date</label>
              <input id="demo-ts-date" type="date" className={styles.input} value={form.workDate} onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label htmlFor="demo-ts-start">Start time</label>
              <input id="demo-ts-start" type="time" className={styles.input} value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label htmlFor="demo-ts-end">End time</label>
              <input id="demo-ts-end" type="time" className={styles.input} value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
            </div>
            <div className={`${styles.field} ${styles.descriptionField}`}>
              <label htmlFor="demo-ts-desc">Description</label>
              <textarea
                id="demo-ts-desc"
                className={styles.input}
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What was done during this period?"
              />
            </div>
          </div>

          {products.length > 0 && (
            <div>
              <p className={styles.productsLabel}>Products</p>
              {products.map((p) => (
                <div key={p.id} className={styles.productRow}>
                  <input className={styles.input} placeholder="Product name" value={p.name} onChange={(e) => setProduct(p.id, { name: e.target.value })} aria-label="Product name" />
                  <select
                    className={styles.input}
                    value={p.billingType}
                    onChange={(e) => setProduct(p.id, { billingType: e.target.value as DemoProduct['billingType'] })}
                    aria-label="Billing type"
                  >
                    <option value="quantity">Quantity</option>
                    <option value="hourly">Hour</option>
                  </select>
                  {p.billingType === 'quantity' ? (
                    <input className={styles.input} placeholder="Unit (optional)" maxLength={20} value={p.unit} onChange={(e) => setProduct(p.id, { unit: e.target.value })} aria-label="Unit" />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <input
                    className={styles.input}
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder={p.billingType === 'hourly' ? 'Hours' : 'Quantity'}
                    value={p.quantity}
                    onChange={(e) => setProduct(p.id, { quantity: Number(e.target.value) })}
                    aria-label="Quantity"
                  />
                  <input
                    className={styles.input}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Unit price ($)"
                    value={p.unitPrice}
                    onChange={(e) => setProduct(p.id, { unitPrice: Number(e.target.value) })}
                    aria-label="Product unit price"
                  />
                  <button type="button" className={styles.removeProductButton} onClick={() => setProducts((list) => list.filter((x) => x.id !== p.id))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.productActions}>
            <button type="button" className={styles.addProductButton} onClick={() => addProduct()}>
              + Add product
            </button>
            {data.services.length > 0 && (
              <CatalogSearch items={data.services} onSelect={(id) => addProduct(id)} formatPrice={formatMoney} />
            )}
          </div>

          <button type="submit" className={styles.submitButton}>
            Save entry
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Entries</h2>
        <div className={styles.filterRow}>
          <div className={styles.field}>
            <label htmlFor="demo-ts-filter">Client</label>
            <select id="demo-ts-filter" className={styles.input} value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
              <option value="">All clients</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {openVisible.length > 0 && (
          <div className={styles.generateBar}>
            <button type="button" className={styles.generateButton} disabled={selectedEntries.length === 0} onClick={generate}>
              {selectedClientCount > 1
                ? `Generate ${selectedClientCount} invoices (${selectedClientCount} clients)`
                : `Generate invoice (${selectedEntries.length} selected)`}
            </button>
            <span className={styles.generateHint}>
              Select open entries across clients, then generate one invoice per client. Invoiced entries can no longer be edited.
            </span>
          </div>
        )}

        {visible.length === 0 ? (
          <div className={styles.empty}>No entries yet.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.tableCaption}>Timesheet entries — scroll horizontally for more columns.</caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.selectCol}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={openVisible.length === 0}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(openVisible.map((e) => e.id)))}
                      aria-label="Select all visible entries"
                    />
                  </th>
                  <th scope="col">Date</th>
                  <th scope="col">Client</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Labor</th>
                  <th scope="col">Products</th>
                  <th scope="col">Subtotal</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const isOpen = e.status === 'open';
                  return (
                    <tr key={e.id} className={isOpen ? '' : styles.invoicedRow}>
                      <td className={styles.selectCol} data-label="Select">
                        <input type="checkbox" checked={selected.has(e.id)} disabled={!isOpen} onChange={() => toggle(e.id)} aria-label={`Select entry for ${clientName(e.clientId)}`} />
                      </td>
                      <td className={styles.nowrap} data-label="Date">
                        {formatDay(e.workDate)}
                      </td>
                      <td className={styles.clientCell} data-label="Client">
                        <div>{clientName(e.clientId)}</div>
                        <div className={styles.rateLine}>{e.description}</div>
                      </td>
                      <td className={styles.nowrap} data-label="Hours">
                        <div>{entryHours(e).toFixed(2)}</div>
                        <div className={styles.rateLine}>{formatMoney(e.hourlyRate)}/hr</div>
                      </td>
                      <td className={styles.nowrap} data-label="Labor">
                        {formatMoney(entryLabor(e))}
                      </td>
                      <td data-label="Products">
                        {e.products.length === 0 ? (
                          <span className={styles.productList}>—</span>
                        ) : (
                          <ul className={styles.productList}>
                            {e.products.map((p) => (
                              <li key={p.id}>
                                {p.name}: {p.quantity} × {formatMoney(p.unitPrice)} = {formatMoney(p.quantity * p.unitPrice)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className={styles.nowrap} data-label="Subtotal">
                        {formatMoney(entrySubtotal(e))}
                      </td>
                      <td data-label="Status">
                        <span className={`${styles.statusBadge} ${isOpen ? styles.statusOpen : styles.statusInvoiced}`}>{isOpen ? 'Open' : 'Invoiced'}</span>
                      </td>
                      <td data-label="Actions" className={styles.actionsCell}>
                        {isOpen && (
                          <button
                            type="button"
                            className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                            title="Delete"
                            aria-label={`Delete entry for ${clientName(e.clientId)}`}
                            onClick={() => update((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== e.id) }))}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

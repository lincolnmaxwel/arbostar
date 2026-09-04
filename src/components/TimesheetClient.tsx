'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/quoteMath';
import styles from '../app/timesheet/timesheet.module.css';

interface TimesheetClientOption {
  id: string;
  name: string;
  email: string;
}

interface TimesheetProduct {
  id: string;
  name: string;
  quantity: string;
  unitPrice: string;
  lineTotal: number;
}

interface TimesheetEntry {
  id: string;
  workDate: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  hourlyRate: string;
  status: 'open' | 'invoiced';
  client: { id: string; name: string };
  products: TimesheetProduct[];
}

interface NewProductRow {
  id: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TimesheetClient() {
  const router = useRouter();
  const [clients, setClients] = useState<TimesheetClientOption[]>([]);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [hourlyRate, setHourlyRate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [filterClientId, setFilterClientId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const [form, setForm] = useState({
    clientId: '',
    workDate: todayLocal(),
    startTime: '09:00',
    endTime: '17:00',
    products: [] as NewProductRow[],
  });
  const [saving, setSaving] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  const loadEntries = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const params = new URLSearchParams();
      if (filterClientId) params.set('clientId', filterClientId);
      if (filterFrom) params.set('dateFrom', filterFrom);
      if (filterTo) params.set('dateTo', filterTo);
      const qs = params.toString();
      try {
        const res = await fetch(`/api/timesheet${qs ? `?${qs}` : ''}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? 'Failed to load timesheet entries.');
          return;
        }
        const body = await res.json();
        setEntries(body.entries);
        // Prune stale selections (entries filtered out or invoiced elsewhere).
        setSelected((prev) => {
          const liveIds = new Set((body.entries as TimesheetEntry[]).map((e) => e.id));
          const next = new Set([...prev].filter((id) => liveIds.has(id)));
          return next;
        });
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [filterClientId, filterFrom, filterTo],
  );

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    fetch('/api/clients')
      .then((res) => (res.ok ? res.json() : { clients: [] }))
      .then((body) => setClients(body.clients ?? []))
      .catch(() => {});
    fetch('/api/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.user?.hourlyRate !== undefined) setHourlyRate(Number(body.user.hourlyRate));
      })
      .catch(() => {});
  }, []);

  function addProductRow() {
    setForm((f) => ({
      ...f,
      products: [...f.products, { id: crypto.randomUUID(), name: '', quantity: '1', unitPrice: '' }],
    }));
  }

  function updateProductRow(id: string, patch: Partial<NewProductRow>) {
    setForm((f) => ({
      ...f,
      products: f.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }

  function removeProductRow(id: string) {
    setForm((f) => ({ ...f, products: f.products.filter((p) => p.id !== id) }));
  }

  const rateNotice = `New entries snapshot your current default hourly rate: ${formatMoney(hourlyRate)}/hr. Changing the default later does not affect existing entries.`;

  const selectedClientId = useMemo(() => {
    for (const id of selected) {
      const entry = entries.find((e) => e.id === id);
      if (entry) return entry.client.id;
    }
    return null;
  }, [selected, entries]);

  async function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!form.clientId) {
      setError('Select a client.');
      return;
    }
    if (!form.workDate) {
      setError('Select a work date.');
      return;
    }
    const startedAt = new Date(`${form.workDate}T${form.startTime}:00`);
    const endedAt = new Date(`${form.workDate}T${form.endTime}:00`);
    if (!(endedAt.getTime() > startedAt.getTime())) {
      setError('End time must be after start time.');
      return;
    }
    for (const p of form.products) {
      if (!p.name.trim()) {
        setError('Every product needs a name.');
        return;
      }
      if (!(Number(p.quantity) > 0)) {
        setError('Product quantity must be positive.');
        return;
      }
      if (p.unitPrice === '' || Number(p.unitPrice) < 0) {
        setError('Product unit price cannot be negative.');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.clientId,
          workDate: form.workDate,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          products: form.products.map((p) => ({
            name: p.name.trim(),
            quantity: Number(p.quantity),
            unitPrice: Number(p.unitPrice),
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = typeof body.error === 'string' ? body.error : 'Could not save the entry.';
        setError(msg);
        return;
      }
      setForm((f) => ({ ...f, clientId: '', products: [] }));
      setNotice('Entry saved.');
      await loadEntries({ silent: true });
    } finally {
      setSaving(false);
    }
  }

  function toggleSelect(id: string, status: string, clientId: string) {
    if (status !== 'open') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // Mixed-client selection is never allowed: a generated invoice must
      // belong to a single client.
      if (selectedClientId && selectedClientId !== clientId) {
        setError('Select entries for one client at a time.');
        return prev;
      }
      next.add(id);
      return next;
    });
  }

  async function handleGenerateInvoice() {
    if (selected.size === 0) return;
    setError(null);
    setNotice(null);
    setGenerating(true);
    try {
      const res = await fetch('/api/timesheet/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClientId,
          entryIds: [...selected],
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? body?.error ?? 'Could not generate the invoice.');
        // On conflict the selection is stale — reload and clear it.
        await loadEntries({ silent: true });
        return;
      }
      setNotice(`Invoice #${body.invoice.number} created and emailed.`);
      setSelected(new Set());
      await loadEntries({ silent: true });
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteEntry(entry: TimesheetEntry) {
    if (!window.confirm('Delete this entry?')) return;
    setError(null);
    const res = await fetch(`/api/timesheet/${entry.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? 'Could not delete the entry.');
      return;
    }
    await loadEntries({ silent: true });
  }

  function handleClearFilters() {
    setFilterClientId('');
    setFilterFrom('');
    setFilterTo('');
  }

  function handleFilterApply() {
    setError(null);
    if (filterFrom && filterTo && filterFrom > filterTo) {
      setError('The "From" date must be on or before the "To" date.');
      return;
    }
    loadEntries();
  }

  const selectedEntryIds = [...selected];
  const openEntries = useMemo(() => entries.filter((e) => e.status === 'open'), [entries]);

  function entryLaborTotal(e: TimesheetEntry): number {
    const hours = e.durationMinutes / 60;
    return hours * Number(e.hourlyRate);
  }

  function entrySubtotal(e: TimesheetEntry): number {
    return entryLaborTotal(e) + e.products.reduce((sum, p) => sum + Number(p.lineTotal), 0);
  }

  return (
    <div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>New entry</h2>
        <p className={styles.rateNotice}>{rateNotice}</p>

        <form onSubmit={handleCreateEntry}>
          <div className={styles.entryForm}>
            <div className={styles.field}>
              <label htmlFor="ts-client">Client</label>
              <select
                id="ts-client"
                className={styles.input}
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              >
                <option value="">Select a client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="ts-date">Work date</label>
              <input
                id="ts-date"
                type="date"
                className={styles.input}
                value={form.workDate}
                onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="ts-start">Start time</label>
              <input
                id="ts-start"
                type="time"
                className={styles.input}
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="ts-end">End time</label>
              <input
                id="ts-end"
                type="time"
                className={styles.input}
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </div>
          </div>

          {form.products.length > 0 && (
            <div>
              <p className={styles.productsLabel}>Products</p>
              {form.products.map((p) => (
                <div key={p.id} className={styles.productRow}>
                  <input
                    className={styles.input}
                    placeholder="Product name"
                    value={p.name}
                    onChange={(e) => updateProductRow(p.id, { name: e.target.value })}
                    aria-label="Product name"
                  />
                  <input
                    className={styles.input}
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="Qty"
                    value={p.quantity}
                    onChange={(e) => updateProductRow(p.id, { quantity: e.target.value })}
                    aria-label="Product quantity"
                  />
                  <input
                    className={styles.input}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Unit price ($)"
                    value={p.unitPrice}
                    onChange={(e) => updateProductRow(p.id, { unitPrice: e.target.value })}
                    aria-label="Product unit price"
                  />
                  <button
                    type="button"
                    className={styles.removeProductButton}
                    onClick={() => removeProductRow(p.id)}
                    aria-label={`Remove product ${p.name || 'row'}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <button type="button" className={styles.addProductButton} onClick={addProductRow}>
            + Add product
          </button>

          <button type="submit" className={styles.submitButton} disabled={saving}>
            {saving ? 'Saving...' : 'Save entry'}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Entries</h2>
        <div className={styles.filterRow}>
          <div className={styles.field}>
            <label htmlFor="filter-client">Client</label>
            <select id="filter-client" className={styles.input} value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)}>
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="filter-from">From</label>
            <input id="filter-from" type="date" className={styles.input} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="filter-to">To</label>
            <input id="filter-to" type="date" className={styles.input} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </div>
          <div className={styles.filterActions}>
            <button type="button" className={styles.actionButton} onClick={handleFilterApply}>
              Apply
            </button>
            <button type="button" className={styles.actionButton} onClick={handleClearFilters}>
              Clear filters
            </button>
          </div>
        </div>

        {loading ? (
          <div className={styles.empty}>
            <p>Loading entries...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className={styles.empty}>
            <p>No entries yet — add your first entry above.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.tableCaption}>Timesheet entries — scroll horizontally for more columns.</caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.selectCol}>
                    <span className={styles.srOnly}>Select</span>
                  </th>
                  <th scope="col">Date</th>
                  <th scope="col">Client</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Rate</th>
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
                {entries.map((e) => {
                  const isOpen = e.status === 'open';
                  const hours = (e.durationMinutes / 60).toFixed(2);
                  const blockedByMixedClient = isOpen && selectedClientId !== null && selectedClientId !== e.client.id;
                  return (
                    <tr key={e.id} className={isOpen ? '' : styles.invoicedRow}>
                      <td className={styles.selectCol}>
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          disabled={!isOpen || blockedByMixedClient}
                          onChange={() => toggleSelect(e.id, e.status, e.client.id)}
                          aria-label={`Select entry for ${e.client.name} on ${e.workDate.slice(0, 10)}`}
                        />
                      </td>
                      <td className={styles.nowrap}>{e.workDate.slice(0, 10)}</td>
                      <td>{e.client.name}</td>
                      <td className={styles.nowrap}>{hours}</td>
                      <td className={styles.nowrap}>{formatMoney(Number(e.hourlyRate))}/hr</td>
                      <td className={styles.nowrap}>{formatMoney(entryLaborTotal(e))}</td>
                      <td>
                        {e.products.length === 0 ? (
                          <span className={styles.productList}>—</span>
                        ) : (
                          <ul className={styles.productList}>
                            {e.products.map((p) => (
                              <li key={p.id}>
                                {p.name}: {p.quantity} × {formatMoney(Number(p.unitPrice))} = {formatMoney(Number(p.lineTotal))}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className={styles.nowrap}>{formatMoney(entrySubtotal(e))}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${isOpen ? styles.statusOpen : styles.statusInvoiced}`}>
                          {isOpen ? 'Open' : 'Invoiced'}
                        </span>
                      </td>
                      <td>
                        {isOpen && (
                          <div className={styles.rowActions}>
                            <button type="button" className={styles.actionButton} onClick={() => handleDeleteEntry(e)}>
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {openEntries.length > 0 && (
          <div className={styles.generateBar}>
            <button
              type="button"
              className={styles.generateButton}
              disabled={selectedEntryIds.length === 0 || generating}
              onClick={handleGenerateInvoice}
            >
              {generating ? 'Generating...' : `Generate invoice (${selectedEntryIds.length} selected)`}
            </button>
            <span className={styles.generateHint}>
              Select open entries for one client, then generate a single invoice. Invoiced entries can no longer be edited.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
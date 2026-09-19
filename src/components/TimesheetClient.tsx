'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/quoteMath';
import { formatPhoneInput } from '@/lib/formatPhone';
import styles from '../app/timesheet/timesheet.module.css';

interface TimesheetClientOption {
  id: string;
  name: string;
  email: string;
}

interface ServiceCatalogItem {
  id: string;
  name: string;
  defaultPrice: number | string;
  billingType: 'quantity' | 'hourly';
  unit?: string | null;
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
  serviceName: string;
  status: 'open' | 'invoiced';
  description?: string | null;
  client: { id: string; name: string };
  products: TimesheetProduct[];
  invoice?: { number: number } | null;
}

interface NewProductRow {
  id: string;
  name: string;
  quantity: string;
  unitPrice: string;
  billingType?: ServiceCatalogItem['billingType'];
  unit?: string | null;
}

interface EditProductRow extends NewProductRow {
  originalId?: string;
}

interface EditEntryForm {
  workDate: string;
  startTime: string;
  endTime: string;
  description: string;
  products: EditProductRow[];
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sortClients(clientList: TimesheetClientOption[]): TimesheetClientOption[] {
  return [...clientList].sort((a, b) => a.name.localeCompare(b.name));
}

function durationHoursOrOne(startTime: string, endTime: string): string {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const validTime = (hour: number, minute: number) =>
    Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  if (!validTime(startHour, startMinute) || !validTime(endHour, endMinute)) return '1';

  const startedMinutes = startHour * 60 + startMinute;
  const endedMinutes = endHour * 60 + endMinute;
  if (endedMinutes <= startedMinutes) return '1';
  return String((endedMinutes - startedMinutes) / 60);
}

function productQuantityLabel(product: NewProductRow): string {
  if (product.billingType === 'hourly') return 'Hours';
  const unit = product.unit?.trim();
  return unit ? `Qty (${unit})` : 'Qty';
}

const EMPTY_NEW_CLIENT = { name: '', email: '', phone: '', address: '' };

export function TimesheetClient() {
  const router = useRouter();
  const [clients, setClients] = useState<TimesheetClientOption[]>([]);
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
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
    description: '',
    products: [] as NewProductRow[],
  });
  const [saving, setSaving] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientForm, setNewClientForm] = useState(EMPTY_NEW_CLIENT);
  const [newClientSaving, setNewClientSaving] = useState(false);
  const [newClientError, setNewClientError] = useState<string | null>(null);
  const [catalogSelection, setCatalogSelection] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditEntryForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editCatalogSelection, setEditCatalogSelection] = useState('');
  const [detailsEntry, setDetailsEntry] = useState<TimesheetEntry | null>(null);

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
    fetch('/api/timesheet/clients')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message ?? body?.error ?? 'Failed to load clients.');
        return body;
      })
      .then((body) => setClients(sortClients(body?.clients ?? [])))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load clients.'));
    fetch('/api/services')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message ?? body?.error ?? 'Failed to load services.');
        return body;
      })
      .then((body) => setCatalog(body?.items ?? []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load services.'));
    fetch('/api/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.user?.hourlyRate !== undefined) setHourlyRate(Number(body.user.hourlyRate));
      })
    .catch(() => {});
  }, []);

  useEffect(() => {
    if (!detailsEntry) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDetailsEntry(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailsEntry]);

  async function handleCreateClient() {
    setNewClientError(null);
    if (!newClientForm.name.trim() || !newClientForm.email.trim()) {
      setNewClientError('Name and email are required.');
      return;
    }

    setNewClientSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newClientForm.name.trim(),
          email: newClientForm.email.trim(),
          phone: newClientForm.phone.trim(),
          address: newClientForm.address.trim(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setNewClientError(
          typeof body?.message === 'string'
            ? body.message
            : res.status === 403
              ? 'This feature is not enabled for your account.'
              : 'Could not create client.',
        );
        return;
      }

      const created = body?.client as TimesheetClientOption | undefined;
      if (!created?.id) {
        setNewClientError('Could not create client.');
        return;
      }
      setClients((current) => sortClients([...current, created]));
      setForm((current) => ({ ...current, clientId: created.id }));
      setNewClientForm(EMPTY_NEW_CLIENT);
      setNewClientOpen(false);
      setNotice(`Client ${created.name} added.`);
      router.refresh();
    } catch {
      setNewClientError('Could not create client. Check your connection and try again.');
    } finally {
      setNewClientSaving(false);
    }
  }

  function handleCatalogSelection(itemId: string) {
    setCatalogSelection(itemId);
    if (!itemId) return;
    const item = catalog.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setForm((current) => ({
      ...current,
      products: [
        ...current.products,
        {
          id: crypto.randomUUID(),
          name: item.name,
          quantity: item.billingType === 'hourly' ? durationHoursOrOne(current.startTime, current.endTime) : '1',
          unitPrice: String(item.defaultPrice),
          billingType: item.billingType,
          unit: item.unit ?? null,
        },
      ],
    }));
    setCatalogSelection('');
  }

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

  function handleEditCatalogSelection(itemId: string) {
    setEditCatalogSelection(itemId);
    if (!itemId) return;
    const item = catalog.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setEditForm((current) => {
      if (!current) return current;
      return {
        ...current,
        products: [
          ...current.products,
          {
            id: crypto.randomUUID(),
            name: item.name,
            quantity: item.billingType === 'hourly' ? durationHoursOrOne(current.startTime, current.endTime) : '1',
            unitPrice: String(item.defaultPrice),
            billingType: item.billingType,
            unit: item.unit ?? null,
          },
        ],
      };
    });
    setEditCatalogSelection('');
  }

  function addEditProductRow() {
    setEditForm((current) => current ? {
      ...current,
      products: [...current.products, { id: crypto.randomUUID(), name: '', quantity: '1', unitPrice: '' }],
    } : current);
  }

  function updateEditProductRow(id: string, patch: Partial<EditProductRow>) {
    setEditForm((current) => current ? {
      ...current,
      products: current.products.map((product) => (product.id === id ? { ...product, ...patch } : product)),
    } : current);
  }

  function removeEditProductRow(id: string) {
    setEditForm((current) => current ? {
      ...current,
      products: current.products.filter((product) => product.id !== id),
    } : current);
  }

  function timeInputValue(isoDate: string): string {
    const date = new Date(isoDate);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function handleStartEdit(entry: TimesheetEntry) {
    if (entry.status !== 'open') return;
    setError(null);
    setNotice(null);
    setEditingEntryId(entry.id);
    setEditCatalogSelection('');
    setEditForm({
      workDate: entry.workDate.slice(0, 10),
      startTime: timeInputValue(entry.startedAt),
      endTime: timeInputValue(entry.endedAt),
      description: entry.description ?? '',
      products: entry.products.map((product) => ({
        id: product.id,
        originalId: product.id,
        name: product.name,
        quantity: product.quantity,
        unitPrice: product.unitPrice,
      })),
    });
  }

  function handleCancelEdit() {
    setEditingEntryId(null);
    setEditForm(null);
    setEditCatalogSelection('');
  }

  async function handleEditEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!editingEntryId || !editForm) return;
    setError(null);
    setNotice(null);
    if (!editForm.workDate) {
      setError('Select a work date.');
      return;
    }
    if (!editForm.description.trim()) {
      setError('Enter a description of the work done.');
      return;
    }
    const startedAt = new Date(`${editForm.workDate}T${editForm.startTime}:00`);
    const endedAt = new Date(`${editForm.workDate}T${editForm.endTime}:00`);
    if (!(endedAt.getTime() > startedAt.getTime())) {
      setError('End time must be after start time.');
      return;
    }
    for (const product of editForm.products) {
      if (!product.name.trim()) {
        setError('Every product needs a name.');
        return;
      }
      if (!(Number(product.quantity) > 0)) {
        setError('Product quantity must be positive.');
        return;
      }
      if (product.unitPrice === '' || !(Number(product.unitPrice) >= 0)) {
        setError('Product unit price cannot be negative.');
        return;
      }
    }
    const entry = entries.find((candidate) => candidate.id === editingEntryId);
    if (!entry || entry.status !== 'open') {
      setError('This entry is no longer editable.');
      handleCancelEdit();
      return;
    }

    setEditSaving(true);
    try {
      const res = await fetch(`/api/timesheet/${editingEntryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate: editForm.workDate,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          description: editForm.description.trim(),
          products: editForm.products.map((product) => ({
            ...(product.originalId ? { id: product.originalId } : {}),
            name: product.name.trim(),
            quantity: Number(product.quantity),
            unitPrice: Number(product.unitPrice),
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? body?.message ?? 'Could not update the entry.');
        return;
      }
      handleCancelEdit();
      setNotice('Entry updated.');
      await loadEntries({ silent: true });
    } catch {
      setError('Could not update the entry. Check your connection and try again.');
    } finally {
      setEditSaving(false);
    }
  }

  const rateNotice = `New entries snapshot your current default hourly rate: ${formatMoney(hourlyRate)}/hr. Changing the default later does not affect existing entries.`;

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
    if (!form.description.trim()) {
      setError('Enter a description of the work done.');
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
          description: form.description.trim(),
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
      setForm((f) => ({ ...f, clientId: '', description: '', products: [] }));
      setNotice('Entry saved.');
      await loadEntries({ silent: true });
    } finally {
      setSaving(false);
    }
  }

  function toggleSelect(id: string, status: string) {
    if (status !== 'open') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      next.add(id);
      return next;
    });
  }

  async function handleGenerateInvoice() {
    if (selectedEntries.length === 0) return;
    setError(null);
    setNotice(null);
    setGenerating(true);
    try {
      const groups = new Map<string, { clientName: string; entryIds: string[] }>();
      for (const entry of selectedEntries) {
        const group = groups.get(entry.client.id);
        if (group) {
          group.entryIds.push(entry.id);
        } else {
          groups.set(entry.client.id, { clientName: entry.client.name, entryIds: [entry.id] });
        }
      }

      const created: Array<{ clientName: string; invoiceNumber: string }> = [];
      const failures: string[] = [];
      for (const [clientId, group] of groups) {
        try {
          const res = await fetch('/api/timesheet/invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, entryIds: group.entryIds }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            failures.push(`Failed for ${group.clientName}: ${body?.message ?? body?.error ?? 'Could not generate the invoice.'}`);
            continue;
          }
          created.push({
            clientName: group.clientName,
            invoiceNumber: String(body?.invoice?.number ?? 'unknown'),
          });
        } catch {
          failures.push(`Failed for ${group.clientName}: Could not generate the invoice. Check your connection and try again.`);
        }
      }

      if (created.length > 0) {
        setNotice(
          `${created.length} invoice${created.length === 1 ? '' : 's'} created: ${created
            .map((invoice) => `#${invoice.invoiceNumber} (${invoice.clientName})`)
            .join(', ')}.`,
        );
      }
      if (failures.length > 0) setError(failures.join(' '));
      setSelected(new Set());
      await loadEntries({ silent: true });
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteEntry(entry: TimesheetEntry) {
    const confirmMessage = entry.status === 'invoiced'
      ? 'This entry is part of an invoice. Deleting it will also delete that invoice and all other entries linked to it. Do you want to continue?'
      : 'Delete this entry?';
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    try {
      const res = await fetch(`/api/timesheet/${entry.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? body?.message ?? 'Could not delete the entry.');
        return;
      }
      if (body?.invoiceDeleted === true) {
        const invoiceNumber = body.invoiceNumber ?? body.invoice?.number ?? 'the invoice';
        const linkedEntryCount = body.linkedEntriesDeleted
          ?? body.linkedEntryCount
          ?? body.deletedEntryCount
          ?? body.entriesDeleted;
        const linkedEntriesMessage = typeof linkedEntryCount === 'number'
          ? `${linkedEntryCount} linked ${linkedEntryCount === 1 ? 'entry' : 'entries'}`
          : 'the linked entries';
        setNotice(`Invoice #${invoiceNumber} and ${linkedEntriesMessage} were deleted.`);
      }
      await loadEntries({ silent: true });
    } catch {
      setError('Could not delete the entry. Check your connection and try again.');
    }
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

  const openEntries = useMemo(() => entries.filter((e) => e.status === 'open'), [entries]);
  const openEntryIds = openEntries.map((entry) => entry.id);
  const allVisibleOpenSelected = openEntryIds.length > 0 && openEntryIds.every((id) => selected.has(id));
  const selectedEntries = useMemo(
    () => entries.filter((entry) => entry.status === 'open' && selected.has(entry.id)),
    [entries, selected],
  );
  const selectedEntryIds = selectedEntries.map((entry) => entry.id);
  const selectedClientIds = new Set(selectedEntries.map((entry) => entry.client.id));
  const selectedClientCount = selectedClientIds.size;

  function toggleSelectAllVisible() {
    setSelected(allVisibleOpenSelected ? new Set() : new Set(openEntryIds));
  }

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
              <div className={styles.clientPicker}>
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
                <button
                  type="button"
                  className={styles.addClientButton}
                  onClick={() => {
                    setNewClientOpen((open) => !open);
                    setNewClientError(null);
                  }}
                  aria-expanded={newClientOpen}
                  aria-controls="new-client-inline-form"
                >
                  + New client
                </button>
              </div>
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
            <div className={`${styles.field} ${styles.descriptionField}`}>
              <label htmlFor="ts-description">Description</label>
              <textarea
                id="ts-description"
                className={styles.input}
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What was done during this period?"
                required
              />
            </div>
          </div>

          {newClientOpen && (
            <div
              id="new-client-inline-form"
              className={styles.inlineClientForm}
              role="group"
              aria-labelledby="new-client-inline-title"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateClient();
                }
              }}
            >
              <h3 id="new-client-inline-title" className={styles.inlineClientTitle}>New client</h3>
              {newClientError && <div className={styles.error} role="alert">{newClientError}</div>}
              <div className={styles.newClientFields}>
                <div className={styles.field}>
                  <label htmlFor="new-ts-client-name">Name</label>
                  <input
                    id="new-ts-client-name"
                    className={styles.input}
                    value={newClientForm.name}
                    onChange={(e) => setNewClientForm((current) => ({ ...current, name: e.target.value }))}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="new-ts-client-email">Email</label>
                  <input
                    id="new-ts-client-email"
                    type="email"
                    className={styles.input}
                    value={newClientForm.email}
                    onChange={(e) => setNewClientForm((current) => ({ ...current, email: e.target.value }))}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="new-ts-client-phone">Phone</label>
                  <input
                    id="new-ts-client-phone"
                    type="tel"
                    className={styles.input}
                    value={newClientForm.phone}
                    onChange={(e) => setNewClientForm((current) => ({ ...current, phone: formatPhoneInput(e.target.value) }))}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="new-ts-client-address">Address</label>
                  <input
                    id="new-ts-client-address"
                    className={styles.input}
                    value={newClientForm.address}
                    onChange={(e) => setNewClientForm((current) => ({ ...current, address: e.target.value }))}
                  />
                </div>
              </div>
              <div className={styles.inlineClientActions}>
                <button type="button" className={styles.submitButton} onClick={() => void handleCreateClient()} disabled={newClientSaving}>
                  {newClientSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => {
                    setNewClientOpen(false);
                    setNewClientError(null);
                  }}
                  disabled={newClientSaving}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

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
                    placeholder={productQuantityLabel(p)}
                    value={p.quantity}
                    onChange={(e) => updateProductRow(p.id, { quantity: e.target.value })}
                    aria-label={productQuantityLabel(p)}
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

          <div className={styles.productActions}>
            <button type="button" className={styles.addProductButton} onClick={addProductRow}>
              + Add product
            </button>
            {catalog.length > 0 && (
              <select
                className={styles.catalogSelect}
                aria-label="Add from catalog"
                value={catalogSelection}
                onChange={(e) => handleCatalogSelection(e.target.value)}
              >
                <option value="">Add from catalog</option>
                {catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({formatMoney(Number(item.defaultPrice))})
                  </option>
                ))}
              </select>
            )}
          </div>

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
                    <input
                      type="checkbox"
                      checked={allVisibleOpenSelected}
                      disabled={openEntryIds.length === 0}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all visible entries"
                    />
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
                  return (
                    <>
                      <tr key={e.id} className={isOpen ? '' : styles.invoicedRow}>
                      <td className={styles.selectCol}>
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          disabled={!isOpen}
                          onChange={() => toggleSelect(e.id, e.status)}
                          aria-label={`Select entry for ${e.client.name} on ${e.workDate.slice(0, 10)}`}
                        />
                      </td>
                      <td className={styles.nowrap}>{e.workDate.slice(0, 10)}</td>
                      <td>
                        <div>{e.client.name}</div>
                        {e.description && <div className={styles.entryDescription}>{e.description}</div>}
                      </td>
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
                        <div className={styles.rowActions}>
                          {isOpen && (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => handleStartEdit(e)}
                              aria-expanded={editingEntryId === e.id}
                              aria-controls={`edit-entry-${e.id}`}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.detailsButton}`}
                            onClick={() => setDetailsEntry(e)}
                            aria-label={`View details for ${e.client.name} on ${e.workDate.slice(0, 10)}`}
                          >
                            View details
                          </button>
                          <button type="button" className={styles.actionButton} onClick={() => handleDeleteEntry(e)}>
                            Delete
                          </button>
                        </div>
                      </td>
                      </tr>
                      {editingEntryId === e.id && editForm && (
                        <tr key={`${e.id}-edit`}>
                        <td colSpan={10}>
                          <form id={`edit-entry-${e.id}`} className={styles.editEntryForm} onSubmit={handleEditEntry}>
                            <div className={styles.editEntryHeader}>
                              <h3 className={styles.editEntryTitle}>Edit entry</h3>
                              <p className={styles.editEntryHint}>Update the date, time, description, or products for this open entry.</p>
                            </div>
                            <div className={styles.editEntryFields}>
                              <div className={styles.field}>
                                <label htmlFor={`edit-date-${e.id}`}>Work date</label>
                                <input
                                  id={`edit-date-${e.id}`}
                                  type="date"
                                  className={styles.input}
                                  value={editForm.workDate}
                                  onChange={(event) => setEditForm((current) => current ? { ...current, workDate: event.target.value } : current)}
                                  required
                                />
                              </div>
                              <div className={styles.field}>
                                <label htmlFor={`edit-start-${e.id}`}>Start time</label>
                                <input
                                  id={`edit-start-${e.id}`}
                                  type="time"
                                  className={styles.input}
                                  value={editForm.startTime}
                                  onChange={(event) => setEditForm((current) => current ? { ...current, startTime: event.target.value } : current)}
                                  required
                                />
                              </div>
                              <div className={styles.field}>
                                <label htmlFor={`edit-end-${e.id}`}>End time</label>
                                <input
                                  id={`edit-end-${e.id}`}
                                  type="time"
                                  className={styles.input}
                                  value={editForm.endTime}
                                  onChange={(event) => setEditForm((current) => current ? { ...current, endTime: event.target.value } : current)}
                                  required
                                />
                              </div>
                              <div className={`${styles.field} ${styles.descriptionField}`}>
                                <label htmlFor={`edit-description-${e.id}`}>Description</label>
                                <textarea
                                  id={`edit-description-${e.id}`}
                                  className={styles.input}
                                  rows={3}
                                  value={editForm.description}
                                  onChange={(event) => setEditForm((current) => current ? { ...current, description: event.target.value } : current)}
                                  placeholder="What was done during this period?"
                                  required
                                />
                              </div>
                            </div>
                            {editForm.products.length > 0 && (
                              <div>
                                <p className={styles.productsLabel}>Products</p>
                                {editForm.products.map((product) => (
                                  <div key={product.id} className={styles.productRow}>
                                    <input
                                      className={styles.input}
                                      placeholder="Product name"
                                      value={product.name}
                                      onChange={(event) => updateEditProductRow(product.id, { name: event.target.value })}
                                      aria-label="Product name"
                                    />
                                    <input
                                      className={styles.input}
                                      type="number"
                                      step="0.001"
                                      min="0"
                                      placeholder={productQuantityLabel(product)}
                                      value={product.quantity}
                                      onChange={(event) => updateEditProductRow(product.id, { quantity: event.target.value })}
                                      aria-label={productQuantityLabel(product)}
                                    />
                                    <input
                                      className={styles.input}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="Unit price ($)"
                                      value={product.unitPrice}
                                      onChange={(event) => updateEditProductRow(product.id, { unitPrice: event.target.value })}
                                      aria-label="Product unit price"
                                    />
                                    <button
                                      type="button"
                                      className={styles.removeProductButton}
                                      onClick={() => removeEditProductRow(product.id)}
                                      aria-label={`Remove product ${product.name || 'row'}`}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className={styles.productActions}>
                              <button type="button" className={styles.addProductButton} onClick={addEditProductRow}>
                                + Add product
                              </button>
                              {catalog.length > 0 && (
                                <select
                                  className={styles.catalogSelect}
                                  aria-label="Add from catalog"
                                  value={editCatalogSelection}
                                  onChange={(event) => handleEditCatalogSelection(event.target.value)}
                                >
                                  <option value="">Add from catalog</option>
                                  {catalog.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name} ({formatMoney(Number(item.defaultPrice))})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                            <div className={styles.editEntryActions}>
                              <button type="submit" className={styles.submitButton} disabled={editSaving}>
                                {editSaving ? 'Saving...' : 'Save'}
                              </button>
                              <button type="button" className={styles.actionButton} onClick={handleCancelEdit} disabled={editSaving}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        </td>
                        </tr>
                      )}
                    </>
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
              {generating
                ? 'Generating...'
                : selectedClientCount > 1
                  ? `Generate ${selectedClientCount} invoices (${selectedClientCount} clients)`
                  : `Generate invoice (${selectedEntryIds.length} selected)`}
            </button>
            <span className={styles.generateHint}>
              Select open entries across clients, then generate one invoice per client. Invoiced entries can no longer be edited.
            </span>
          </div>
        )}
      </div>

      {detailsEntry && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="timesheet-entry-details-title"
          onClick={() => setDetailsEntry(null)}
        >
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 id="timesheet-entry-details-title" className={styles.modalTitle}>Timesheet entry details</h2>
              <button type="button" className={styles.modalClose} onClick={() => setDetailsEntry(null)} aria-label="Close details">
                &times;
              </button>
            </div>

            <div className={styles.detailsGrid}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Client</span>
                <span className={styles.detailValue}>{detailsEntry.client.name}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Date</span>
                <span className={styles.detailValue}>{detailsEntry.workDate.slice(0, 10)}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Start time</span>
                <span className={styles.detailValue}>{timeInputValue(detailsEntry.startedAt)}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>End time</span>
                <span className={styles.detailValue}>{timeInputValue(detailsEntry.endedAt)}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Service name</span>
                <span className={styles.detailValue}>{detailsEntry.serviceName}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Hourly rate</span>
                <span className={styles.detailValue}>{formatMoney(Number(detailsEntry.hourlyRate))}/hr</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Status</span>
                <span className={styles.detailValue}>{detailsEntry.status === 'open' ? 'Open' : 'Invoiced'}</span>
              </div>
              {detailsEntry.status === 'invoiced' && detailsEntry.invoice?.number !== undefined && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Invoice</span>
                  <span className={styles.detailValue}>#{detailsEntry.invoice.number}</span>
                </div>
              )}
            </div>

            <div className={styles.detailSection}>
              <h3 className={styles.detailSectionTitle}>Description</h3>
              <p className={styles.detailDescription}>{detailsEntry.description || '—'}</p>
            </div>

            <div className={styles.detailSection}>
              <h3 className={styles.detailSectionTitle}>Products</h3>
              {detailsEntry.products.length === 0 ? (
                <p className={styles.detailValue}>No products</p>
              ) : (
                <table className={styles.detailProducts}>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Unit price</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailsEntry.products.map((product) => (
                      <tr key={product.id}>
                        <td>{product.name}</td>
                        <td>{product.quantity}</td>
                        <td>{formatMoney(Number(product.unitPrice))}</td>
                        <td>{formatMoney(Number(product.lineTotal))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className={styles.modalActions}>
              <button type="button" className={styles.actionButton} onClick={() => setDetailsEntry(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

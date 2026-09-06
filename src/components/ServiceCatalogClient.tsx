'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/quoteMath';
import styles from '@/app/services/services.module.css';

interface ServiceCatalogItem {
  id: string;
  name: string;
  defaultPrice: number | string;
  billingType: 'quantity' | 'hourly';
  unit?: string | null;
}

type ServiceForm = {
  name: string;
  defaultPrice: string;
  billingType: ServiceCatalogItem['billingType'];
  unit: string;
};

const EMPTY_FORM: ServiceForm = { name: '', defaultPrice: '', billingType: 'quantity', unit: '' };

function billingLabel(item: Pick<ServiceCatalogItem, 'billingType' | 'unit'>): string {
  return item.billingType === 'hourly' ? 'Per hour' : `Per ${item.unit?.trim() || 'unit'}`;
}

function priceLabel(billingType: ServiceCatalogItem['billingType'], unit: string): string {
  if (billingType === 'hourly') return 'Default price per hour ($)';
  return unit.trim() ? `Default price per ${unit.trim()} ($)` : 'Default price per unit ($)';
}

function sortItems(items: ServiceCatalogItem[]): ServiceCatalogItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function getError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const value = body as { message?: unknown; error?: unknown };
    if (typeof value.message === 'string') return value.message;
    if (typeof value.error === 'string') return value.error;
  }
  return fallback;
}

export function ServiceCatalogClient() {
  const [items, setItems] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/services')
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(getError(body, 'Failed to load services.'));
        return body;
      })
      .then((body) => {
        if (!cancelled) setItems(sortItems(body?.items ?? []));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load services.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const name = createForm.name.trim();
    const defaultPrice = Number(createForm.defaultPrice);
    if (!name) {
      setError('Service name is required.');
      return;
    }
    if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
      setError('Default price must be a non-negative number.');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        defaultPrice,
        billingType: createForm.billingType,
        unit: createForm.billingType === 'quantity' ? createForm.unit.trim() || undefined : undefined,
      }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(getError(body, 'Could not create service.'));
        return;
      }
      if (!body?.item?.id) {
        setError('Could not create service.');
        return;
      }
      setItems((current) => sortItems([...current, body.item]));
      setCreateForm(EMPTY_FORM);
      setNotice(`Service ${body.item.name} created.`);
    } catch {
      setError('Could not create service. Check your connection and try again.');
    } finally {
      setCreating(false);
    }
  }

  function startEditing(item: ServiceCatalogItem) {
    setError(null);
    setNotice(null);
    setEditingId(item.id);
    setEditForm({
      name: item.name,
      defaultPrice: String(item.defaultPrice),
      billingType: item.billingType,
      unit: item.unit ?? '',
    });
  }

  async function handleSave(itemId: string) {
    setError(null);
    setNotice(null);
    const name = editForm.name.trim();
    const defaultPrice = Number(editForm.defaultPrice);
    if (!name) {
      setError('Service name is required.');
      return;
    }
    if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
      setError('Default price must be a non-negative number.');
      return;
    }

    setSavingId(itemId);
    try {
      const res = await fetch(`/api/services/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        defaultPrice,
        billingType: editForm.billingType,
        unit: editForm.billingType === 'quantity' ? editForm.unit.trim() || undefined : undefined,
      }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(getError(body, 'Could not update service.'));
        return;
      }
      if (!body?.item?.id) {
        setError('Could not update service.');
        return;
      }
      setItems((current) => sortItems(current.map((item) => (item.id === itemId ? body.item : item))));
      setEditingId(null);
      setNotice(`Service ${body.item.name} updated.`);
    } catch {
      setError('Could not update service. Check your connection and try again.');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(item: ServiceCatalogItem) {
    if (!window.confirm(`Delete service “${item.name}”? Existing timesheet entries will not change.`)) return;
    setError(null);
    setNotice(null);
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/services/${item.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(getError(body, 'Could not delete service.'));
        return;
      }
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      if (editingId === item.id) setEditingId(null);
      setNotice(`Service ${item.name} deleted.`);
    } catch {
      setError('Could not delete service. Check your connection and try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={styles.page}>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Add service</h2>
        <p className={styles.sectionHint}>Services appear as shortcuts when adding products to a timesheet entry.</p>
        <form className={styles.createForm} onSubmit={handleCreate}>
          <div className={styles.field}>
            <label htmlFor="new-service-name">Name</label>
            <input
              id="new-service-name"
              className={styles.input}
              value={createForm.name}
              onChange={(e) => setCreateForm((current) => ({ ...current, name: e.target.value }))}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="new-service-billing-type">Billed by</label>
            <select
              id="new-service-billing-type"
              className={styles.input}
              value={createForm.billingType}
              onChange={(e) => setCreateForm((current) => ({ ...current, billingType: e.target.value as ServiceForm['billingType'] }))}
            >
              <option value="quantity">Quantity</option>
              <option value="hourly">Hour</option>
            </select>
          </div>
          {createForm.billingType === 'quantity' && (
            <div className={styles.field}>
              <label htmlFor="new-service-unit">Unit <span className={styles.optional}>(optional)</span></label>
              <input
                id="new-service-unit"
                className={styles.input}
                placeholder="kg, L, each..."
                value={createForm.unit}
                onChange={(e) => setCreateForm((current) => ({ ...current, unit: e.target.value }))}
              />
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor="new-service-price">{priceLabel(createForm.billingType, createForm.unit)}</label>
            <input
              id="new-service-price"
              type="number"
              min="0"
              step="0.01"
              className={styles.input}
              value={createForm.defaultPrice}
              onChange={(e) => setCreateForm((current) => ({ ...current, defaultPrice: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className={styles.primaryButton} disabled={creating}>
            {creating ? 'Adding...' : 'Add service'}
          </button>
        </form>
      </div>

      <div className={styles.listSection}>
        <h2 className={styles.sectionTitle}>Services</h2>
        {loading ? (
          <div className={styles.empty}>Loading services...</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>No services yet. Add your first service above.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>Service catalog</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Billed by</th>
                  <th scope="col">Default price</th>
                  <th scope="col"><span className={styles.srOnly}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isEditing = editingId === item.id;
                  const isBusy = savingId === item.id || deletingId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        {isEditing ? (
                          <label className={styles.inlineField}>
                            <span className={styles.srOnly}>Service name</span>
                            <input
                              className={styles.input}
                              value={editForm.name}
                              onChange={(e) => setEditForm((current) => ({ ...current, name: e.target.value }))}
                              disabled={isBusy}
                            />
                          </label>
                        ) : (
                          <span className={styles.itemName}>{item.name}</span>
                        )}
                      </td>
                      <td>{billingLabel(item)}</td>
                      <td>
                        {isEditing ? (
                          <label className={styles.inlineField}>
                            <span className={styles.srOnly}>Default price</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className={styles.input}
                              value={editForm.defaultPrice}
                              onChange={(e) => setEditForm((current) => ({ ...current, defaultPrice: e.target.value }))}
                              disabled={isBusy}
                            />
                          </label>
                        ) : (
                          formatMoney(Number(item.defaultPrice))
                        )}
                      </td>
                      <td className={styles.actionsCell}>
                        {isEditing ? (
                          <>
                            <button type="button" className={styles.primaryButton} onClick={() => void handleSave(item.id)} disabled={isBusy}>
                              {savingId === item.id ? 'Saving...' : 'Save'}
                            </button>
                            <button type="button" className={styles.secondaryButton} onClick={() => setEditingId(null)} disabled={isBusy}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className={styles.secondaryButton} onClick={() => startEditing(item)} disabled={isBusy}>
                              Edit
                            </button>
                            <button type="button" className={styles.deleteButton} onClick={() => void handleDelete(item)} disabled={isBusy}>
                              {deletingId === item.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </>
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

'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/quoteMath';
import { uid, type DemoService } from '@/lib/demoData';
import styles from '@/app/services/services.module.css';
import type { DemoScreenProps } from './demoTypes';

const blank = { name: '', billingType: 'quantity' as DemoService['billingType'], unit: '', defaultPrice: '' };

function priceLabel(billingType: DemoService['billingType'], unit: string) {
  if (billingType === 'hourly') return 'Price per hour ($)';
  return unit.trim() ? `Price per ${unit.trim()} ($)` : 'Price ($)';
}

function billingLabel(s: DemoService) {
  return s.billingType === 'hourly' ? 'Hour' : s.unit ? `Quantity (${s.unit})` : 'Quantity';
}

export function DemoServices({ data, update, toast }: DemoScreenProps) {
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');

  function add(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(form.defaultPrice);
    if (!form.name.trim() || !Number.isFinite(price) || price < 0) return;
    const service: DemoService = {
      id: uid(),
      name: form.name.trim(),
      billingType: form.billingType,
      unit: form.billingType === 'quantity' ? form.unit.trim() : '',
      defaultPrice: price,
    };
    update((d) => ({ ...d, services: [...d.services, service] }));
    setForm(blank);
    toast('Service added. It now shows up as a shortcut on the Timesheet.');
  }

  function savePrice(id: string) {
    const price = Number(editPrice);
    if (!Number.isFinite(price) || price < 0) return;
    update((d) => ({ ...d, services: d.services.map((s) => (s.id === id ? { ...s, defaultPrice: price } : s)) }));
    setEditingId(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Services</h1>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Add service</h2>
        <p className={styles.sectionHint}>Services appear as shortcuts when adding products to a timesheet entry.</p>
        <form className={styles.createForm} onSubmit={add}>
          <div className={styles.field}>
            <label htmlFor="demo-s-name">Name</label>
            <input id="demo-s-name" className={styles.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="demo-s-type">Billed by</label>
            <select
              id="demo-s-type"
              className={styles.input}
              value={form.billingType}
              onChange={(e) => setForm((f) => ({ ...f, billingType: e.target.value as DemoService['billingType'] }))}
            >
              <option value="quantity">Quantity</option>
              <option value="hourly">Hour</option>
            </select>
          </div>
          {form.billingType === 'quantity' && (
            <div className={styles.field}>
              <label htmlFor="demo-s-unit">
                Unit <span className={styles.optional}>(optional)</span>
              </label>
              <input id="demo-s-unit" className={styles.input} placeholder="kg, L, each..." value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor="demo-s-price">{priceLabel(form.billingType, form.unit)}</label>
            <input
              id="demo-s-price"
              type="number"
              min="0"
              step="0.01"
              className={styles.input}
              value={form.defaultPrice}
              onChange={(e) => setForm((f) => ({ ...f, defaultPrice: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className={styles.primaryButton}>
            Add service
          </button>
        </form>
      </div>

      <div className={styles.listSection}>
        <h2 className={styles.sectionTitle}>Services</h2>
        {data.services.length === 0 ? (
          <div className={styles.empty}>No services yet. Add your first service above.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Billed by</th>
                  <th scope="col">Default price</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className={styles.itemName}>{s.name}</span>
                    </td>
                    <td>{billingLabel(s)}</td>
                    <td>
                      {editingId === s.id ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={styles.input}
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          aria-label="Default price"
                        />
                      ) : (
                        formatMoney(s.defaultPrice)
                      )}
                    </td>
                    <td className={styles.actionsCell}>
                      {editingId === s.id ? (
                        <>
                          <button type="button" className={styles.primaryButton} onClick={() => savePrice(s.id)}>
                            Save
                          </button>
                          <button type="button" className={styles.secondaryButton} onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => {
                              setEditingId(s.id);
                              setEditPrice(String(s.defaultPrice));
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={styles.deleteButton}
                            onClick={() => update((d) => ({ ...d, services: d.services.filter((x) => x.id !== s.id) }))}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

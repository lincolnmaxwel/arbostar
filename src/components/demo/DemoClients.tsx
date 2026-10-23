'use client';

import { useMemo, useState } from 'react';
import { uid } from '@/lib/demoData';
import clientStyles from '@/app/clients/clients.module.css';
import formStyles from '@/app/services/services.module.css';
import styles from './demo.module.css';
import type { DemoScreenProps } from './demoTypes';

export function DemoClients({ data, update, toast }: DemoScreenProps) {
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.clients;
    return data.clients.filter((c) => [c.name, c.email, c.phone, c.address].join(' ').toLowerCase().includes(q));
  }, [data.clients, search]);

  const jobs = (name: string) => data.quotes.filter((q) => q.clientName.toLowerCase() === name.toLowerCase()).length;

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    update((d) => ({ ...d, clients: [...d.clients, { id: uid(), ...form, name: form.name.trim() }] }));
    setForm({ name: '', email: '', phone: '', address: '' });
    toast('Client added.');
  }

  function remove(id: string, name: string) {
    update((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== id) }));
    toast(`${name} removed (demo only).`);
  }

  return (
    <div>
      <div className={clientStyles.header}>
        <h1 className={clientStyles.title}>Clients</h1>
      </div>

      <p className={styles.hint}>
        In the real app a client appears here once one of their quotes is scheduled. In the demo you can also add one by hand.
      </p>

      <div className={formStyles.card} style={{ marginBottom: 20 }}>
        <h2 className={formStyles.sectionTitle}>Add client</h2>
        <form className={formStyles.createForm} onSubmit={add}>
          <div className={formStyles.field}>
            <label htmlFor="demo-c-name">Name</label>
            <input id="demo-c-name" className={formStyles.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="demo-c-email">Email</label>
            <input id="demo-c-email" type="email" className={formStyles.input} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="demo-c-phone">Phone</label>
            <input id="demo-c-phone" className={formStyles.input} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className={formStyles.field}>
            <label htmlFor="demo-c-address">Address</label>
            <input id="demo-c-address" className={formStyles.input} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>
          <button type="submit" className={formStyles.primaryButton}>
            Add client
          </button>
        </form>
      </div>

      <input
        type="search"
        className={clientStyles.searchInput}
        placeholder="Search by name, email, phone, or address"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search clients"
      />

      {filtered.length === 0 ? (
        <div className={clientStyles.empty}>
          <p>{data.clients.length === 0 ? 'No clients yet.' : `No clients match "${search}".`}</p>
        </div>
      ) : (
        <table className={clientStyles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Jobs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td className={clientStyles.clientName}>{c.name}</td>
                <td>{c.email || '—'}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.address || '—'}</td>
                <td>{jobs(c.name)}</td>
                <td className={clientStyles.actionsCell}>
                  <button type="button" className={clientStyles.deleteButton} onClick={() => remove(c.id, c.name)}>
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

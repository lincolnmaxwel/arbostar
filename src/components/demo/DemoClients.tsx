'use client';

import { useMemo, useState } from 'react';
import clientStyles from '@/app/clients/clients.module.css';
import type { DemoScreenProps } from './demoTypes';

export function DemoClients({ data, update, toast }: DemoScreenProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.clients;
    return data.clients.filter((c) => [c.name, c.email, c.phone, c.address].join(' ').toLowerCase().includes(q));
  }, [data.clients, search]);

  const jobs = (name: string) => data.quotes.filter((q) => q.clientName.toLowerCase() === name.toLowerCase()).length;

  function remove(id: string, name: string) {
    update((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== id) }));
    toast(`${name} removed (demo only).`);
  }

  return (
    <div>
      <div className={clientStyles.header}>
        <h1 className={clientStyles.title}>Clients</h1>
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
          <p>{data.clients.length === 0 ? 'No clients yet. They appear here when a quote is scheduled or a timesheet entry is logged.' : `No clients match "${search}".`}</p>
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

'use client';

import { useMemo, useState } from 'react';
import { DeleteClientButton } from '@/components/DeleteClientButton';
import { EditClientButton } from '@/components/EditClientButton';
import styles from '@/app/clients/clients.module.css';

interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  quoteCount: number;
}

export function ClientListClient({ clients }: { clients: ClientRow[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const haystack = [c.name, c.email, c.phone, c.address].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [clients, search]);

  return (
    <>
      {clients.length > 0 && (
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by name, email, phone, or address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search clients"
        />
      )}

      {clients.length === 0 ? (
        <div className={styles.empty}>
          <p>No confirmed clients yet — a client shows up here once one of their quotes gets scheduled.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>No clients match &quot;{search}&quot;.</p>
        </div>
      ) : (
        <table className={styles.table}>
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
                <td className={styles.clientName}>{c.name}</td>
                <td>{c.email}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.address || '—'}</td>
                <td>{c.quoteCount}</td>
                <td className={styles.actionsCell}>
                  <EditClientButton client={c} className={styles.editButton} />
                  <DeleteClientButton clientId={c.id} clientName={c.name} className={styles.deleteButton} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

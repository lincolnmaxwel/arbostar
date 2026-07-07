import { getConfirmedClients } from '@/lib/clients';
import styles from './clients.module.css';

// A raw Prisma call gives Next.js no "dynamic" signal (unlike fetch()), so
// without this it silently prerenders the client list ONCE at build time and
// serves that same stale snapshot to everyone forever — new confirmed
// clients would never show up without a fresh deploy.
export const dynamic = 'force-dynamic';

// Session gating is handled by middleware.ts (matcher includes /clients/:path*)
// — every authenticated staff user has equal access to all data (see
// CLAUDE.md), so this page doesn't re-check session itself, same as the
// other staff-facing pages.
export default async function ClientsPage() {
  const clients = await getConfirmedClients();

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Clients</h1>
      </div>

      {clients.length === 0 ? (
        <div className={styles.empty}>
          <p>No confirmed clients yet — a client shows up here once one of their quotes gets scheduled.</p>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Jobs</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className={styles.clientName}>{c.name}</div>
                  <div className={styles.clientEmail}>{c.email}</div>
                </td>
                <td>{c.phone || '—'}</td>
                <td>{c.address || '—'}</td>
                <td>{c.quoteCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

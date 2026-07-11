import { getConfirmedClients } from '@/lib/clients';
import { ClientListClient } from '@/components/ClientListClient';
import { AutoRefresh } from '@/components/AutoRefresh';
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
      <AutoRefresh />
      <div className={styles.header}>
        <h1 className={styles.title}>Clients</h1>
      </div>

      <ClientListClient clients={clients} />
    </div>
  );
}

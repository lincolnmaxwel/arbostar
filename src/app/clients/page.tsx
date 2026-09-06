import { redirect } from 'next/navigation';
import { getConfirmedClients } from '@/lib/clients';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled } from '@/lib/features';
import { ClientListClient } from '@/components/ClientListClient';
import { AutoRefresh } from '@/components/AutoRefresh';
import styles from './clients.module.css';

// A raw Prisma call gives Next.js no "dynamic" signal (unlike fetch()), so
// without this it silently prerenders the client list ONCE at build time and
// serves that same stale snapshot to everyone forever — new confirmed
// clients would never show up without a fresh deploy.
export const dynamic = 'force-dynamic';

// Session gating is handled by middleware.ts (matcher includes /clients/:path*).
// The effective owner scopes the list; the clients_crm feature flag gates the
// whole surface (quotes always work without it).
export default async function ClientsPage() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect('/login');
    throw err;
  }

  if (
    !((await isFeatureEnabled(scope.ownerUserId, 'clients_crm')) || (await isFeatureEnabled(scope.ownerUserId, 'timesheet')))
  ) {
    return (
      <div className={styles.page}>
        <p className={styles.featureDisabled}>
          This feature is not enabled for your account.
        </p>
      </div>
    );
  }

  const clients = await getConfirmedClients(scope.ownerUserId);

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
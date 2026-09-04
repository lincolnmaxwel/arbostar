import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled } from '@/lib/features';
import { prisma } from '@/lib/db';
import { InvoiceListClient } from '@/components/InvoiceListClient';
import { AutoRefresh } from '@/components/AutoRefresh';
import styles from './invoices.module.css';

// See src/app/clients/page.tsx for why this is required: a raw Prisma call
// doesn't signal "dynamic" to Next, so without this the list gets baked into
// a static page at build time and never picks up new invoices.
export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) return null;
    throw err;
  }

  if (!(await isFeatureEnabled(scope.ownerUserId, 'invoices'))) {
    return (
      <div>
        <p className={styles.featureDisabled}>This feature is not enabled for your account.</p>
      </div>
    );
  }

  const invoices = await prisma.invoice.findMany({
    where: { userId: scope.ownerUserId },
    include: { client: true, quote: { select: { number: true } } },
    orderBy: { number: 'desc' },
  });

  const rows = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    source: inv.source,
    quoteNumber: inv.quote?.number ?? null,
    clientName: inv.client.name,
    clientEmail: inv.client.email,
    sentAt: inv.sentAt ? inv.sentAt.toISOString() : null,
    total: Number(inv.total),
    paymentStatus: inv.paymentStatus,
  }));

  return (
    <div>
      <AutoRefresh />
      <div className={styles.header}>
        <h1 className={styles.title}>Invoices</h1>
      </div>

      <InvoiceListClient invoices={rows} />
    </div>
  );
}
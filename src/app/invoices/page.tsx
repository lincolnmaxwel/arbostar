import { prisma } from '@/lib/db';
import { InvoiceListClient } from '@/components/InvoiceListClient';
import { AutoRefresh } from '@/components/AutoRefresh';
import styles from './invoices.module.css';

// See src/app/clients/page.tsx for why this is required: a raw Prisma call
// doesn't signal "dynamic" to Next, so without this the list gets baked into
// a static page at build time and never picks up new invoices.
export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const invoices = await prisma.invoice.findMany({
    include: { quote: { include: { client: true } } },
    orderBy: { number: 'desc' },
  });

  const rows = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    clientName: inv.quote.client.name,
    clientEmail: inv.quote.client.email,
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

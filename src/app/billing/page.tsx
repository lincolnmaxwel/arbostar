export const dynamic = 'force-dynamic';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { BillingClient } from '@/components/BillingClient';
import { AdminSubscriptionsClient } from '@/components/AdminSubscriptionsClient';

// Session protection lives in middleware.ts (/billing/:path*). A regular user
// sees their own subscription (GET /api/billing); an admin sees everyone's
// (GET /api/admin/subscriptions, which re-checks the admin role itself).
export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user?.role === 'admin';
  return <div>{isAdmin ? <AdminSubscriptionsClient /> : <BillingClient />}</div>;
}

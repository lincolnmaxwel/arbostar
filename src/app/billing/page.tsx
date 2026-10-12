export const dynamic = 'force-dynamic';

import { BillingClient } from '@/components/BillingClient';

// Session protection lives in middleware.ts (/billing/:path*) and the data
// comes from GET /api/billing, which always describes the signed-in user.
export default function BillingPage() {
  return (
    <div>
      <BillingClient />
    </div>
  );
}

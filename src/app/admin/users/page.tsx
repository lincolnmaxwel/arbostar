export const dynamic = 'force-dynamic';

import { AdminUsersTabs } from '@/components/AdminUsersTabs';

// Authentication and admin gating live server-side on /api/admin/users (this
// page renders client components that only show data after the API
// authorizes it); middleware.ts already guards /admin/:path* for session.
export default function AdminUsersPage() {
  return (
    <div>
      <AdminUsersTabs />
    </div>
  );
}

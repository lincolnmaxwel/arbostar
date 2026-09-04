export const dynamic = 'force-dynamic';

import { AdminUsersClient } from '@/components/AdminUsersClient';

// Authentication and admin gating live server-side on /api/admin/users (this
// page renders a client component that only shows data after the API
// authorizes it); middleware.ts already guards /admin/:path* for session.
export default function AdminUsersPage() {
  return (
    <div>
      <AdminUsersClient />
    </div>
  );
}
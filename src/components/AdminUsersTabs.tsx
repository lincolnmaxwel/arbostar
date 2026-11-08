'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminUsersClient } from '@/components/AdminUsersClient';
import { AdminSignupRequestsClient } from '@/components/AdminSignupRequestsClient';

type Tab = 'users' | 'approvals' | 'blocked';

// Manage Users page: the user list plus the invite-only sign-up queue and its
// deny list, in separate tabs.
export function AdminUsersTabs() {
  const [tab, setTab] = useState<Tab>('users');
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/signup-requests', { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { pending: unknown[] };
      setPendingCount(body.pending.length);
    } catch {
      // The badge is a convenience; the tab itself shows load errors.
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 16px',
    border: 'none',
    borderBottom: active ? '3px solid var(--color-primary, #075bff)' : '3px solid transparent',
    background: 'none',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    color: 'inherit',
  });

  return (
    <div>
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border, #dde3f0)', marginBottom: 20, flexWrap: 'wrap' }}>
        <button type="button" role="tab" aria-selected={tab === 'users'} style={tabStyle(tab === 'users')} onClick={() => setTab('users')}>
          Users
        </button>
        <button type="button" role="tab" aria-selected={tab === 'approvals'} style={tabStyle(tab === 'approvals')} onClick={() => setTab('approvals')}>
          Pending approvals{pendingCount ? ` (${pendingCount})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'blocked'} style={tabStyle(tab === 'blocked')} onClick={() => setTab('blocked')}>
          Blocked emails
        </button>
      </div>
      {tab === 'users' ? (
        <AdminUsersClient />
      ) : (
        <AdminSignupRequestsClient view={tab} onChanged={refreshCount} />
      )}
    </div>
  );
}

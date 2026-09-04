'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resetViewContext } from '@/lib/clientUserContext';
import styles from '../app/admin/users/admin-users.module.css';

type Role = 'admin' | 'staff';
type UserStatus = 'active' | 'inactive' | 'blocked';
type FeatureKey = 'invoices' | 'timesheet' | 'clients_crm';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  hourlyRate: number;
  createdAt: string;
  features: Record<FeatureKey, boolean>;
}

const FEATURES: { key: FeatureKey; label: string }[] = [
  { key: 'invoices', label: 'Invoices' },
  { key: 'timesheet', label: 'Timesheet' },
  { key: 'clients_crm', label: 'Clients CRM' },
];

const STATUS_LABEL: Record<UserStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  blocked: 'Blocked',
};

export function AdminUsersClient() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [actorId, setActorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [rateValues, setRateValues] = useState<Record<string, string>>({});
  const [passwordResetFor, setPasswordResetFor] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'staff' as Role,
    status: 'active' as UserStatus,
    hourlyRate: '0',
    features: { invoices: false, timesheet: false, clients_crm: false },
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (!res.ok) {
      setError(res.status === 403 ? 'Admin access required.' : 'Failed to load users.');
      setLoading(false);
      return;
    }
    const body = await res.json();
    setUsers(body.users);
    setActorId(body.actorId);
    setRateValues((prev) => {
      const next: Record<string, string> = {};
      for (const u of body.users) next[u.id] = String(u.hourlyRate);
      return { ...prev, ...next };
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          email: createForm.email,
          password: createForm.password,
          role: createForm.role,
          status: createForm.status,
          hourlyRate: Number(createForm.hourlyRate) || 0,
          features: FEATURES.filter((f) => createForm.features[f.key]).map((f) => f.key),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError(body.error ?? 'Failed to create user.');
        return;
      }
      setCreateForm({
        name: '',
        email: '',
        password: '',
        role: 'staff',
        status: 'active',
        hourlyRate: '0',
        features: { invoices: false, timesheet: false, clients_crm: false },
      });
      setShowCreate(false);
      setNotice(`User ${body.user.email} created.`);
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(userId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    setSavingUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, error: body.error ?? 'Update failed.' };
      return { ok: true };
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleStatusChange(user: AdminUser, status: UserStatus) {
    const result = await patchUser(user.id, { status });
    if (!result.ok) {
      setError(result.error ?? 'Update failed.');
      return;
    }
    setNotice(`${user.email} is now ${STATUS_LABEL[status]}.`);
    await load();
  }

  async function handleRoleChange(user: AdminUser, role: Role) {
    const result = await patchUser(user.id, { role });
    if (!result.ok) {
      setError(result.error ?? 'Update failed.');
      return;
    }
    setNotice(`${user.email} is now ${role === 'admin' ? 'an admin' : 'staff'}.`);
    await load();
  }

  async function handleHourlyRateSave(user: AdminUser) {
    const rate = Number(rateValues[user.id]);
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Hourly rate must be a non-negative number.');
      setRateValues((prev) => ({ ...prev, [user.id]: String(user.hourlyRate) }));
      return;
    }
    const result = await patchUser(user.id, { hourlyRate: rate });
    if (!result.ok) {
      setError(result.error ?? 'Update failed.');
      setRateValues((prev) => ({ ...prev, [user.id]: String(user.hourlyRate) }));
      return;
    }
    setNotice(`Hourly rate saved for ${user.email}.`);
    await load();
  }

  async function handleResetPassword(user: AdminUser) {
    if (passwordValue.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    const result = await patchUser(user.id, { password: passwordValue });
    if (!result.ok) {
      setError(result.error ?? 'Update failed.');
      return;
    }
    setNotice(`Password reset for ${user.email}.`);
    setPasswordResetFor(null);
    setPasswordValue('');
  }

  async function handleToggleFeature(user: AdminUser, feature: FeatureKey, enabled: boolean) {
    setSavingUserId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Feature update failed.');
        return;
      }
      setNotice(`${feature} ${enabled ? 'enabled' : 'disabled'} for ${user.email}.`);
      await load();
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleViewAs(user: AdminUser) {
    const res = await fetch('/api/admin/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? 'Failed to start view-as.');
      return;
    }
    resetViewContext();
    router.refresh();
    window.location.href = '/quotes';
  }

  if (loading) return <p className={styles.loading}>Loading users...</p>;
  if (error && users.length === 0) return <p className={styles.error} role="alert">{error}</p>;

  return (
    <div>
      {error && (
        <p className={styles.error} role="alert">{error}</p>
      )}
      {notice && (
        <p className={styles.notice} role="status">{notice}</p>
      )}

      <div className={styles.header}>
        <h1 className={styles.title}>Users</h1>
        <button
          type="button"
          className={styles.newButton}
          onClick={() => setShowCreate((v) => !v)}
          aria-expanded={showCreate}
          aria-controls="create-user-form"
        >
          {showCreate ? 'Cancel' : '+ New user'}
        </button>
      </div>

      {showCreate && (
        <form id="create-user-form" className={styles.createForm} onSubmit={handleCreate}>
          <h2 className={styles.sectionTitle}>Create user</h2>
          {createError && <p className={styles.error} role="alert">{createError}</p>}
          <div className={styles.fieldGrid}>
            <div className={styles.field}>
              <label htmlFor="new-name">Name</label>
              <input
                id="new-name"
                autoComplete="name"
                className={styles.input}
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="new-email">Email</label>
              <input
                id="new-email"
                type="email"
                autoComplete="email"
                className={styles.input}
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="new-password">Initial password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                className={styles.input}
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                minLength={6}
                required
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="new-role">Role</label>
              <select
                id="new-role"
                className={styles.input}
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as Role }))}
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="new-status">Status</label>
              <select
                id="new-status"
                className={styles.input}
                value={createForm.status}
                onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value as UserStatus }))}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="new-hourly-rate">Hourly rate ($)</label>
              <input
                id="new-hourly-rate"
                type="number"
                step="0.01"
                min="0"
                className={styles.input}
                value={createForm.hourlyRate}
                onChange={(e) => setCreateForm((f) => ({ ...f, hourlyRate: e.target.value }))}
              />
            </div>
          </div>
          <fieldset className={styles.featureFieldset}>
            <legend>Features</legend>
            {FEATURES.map((f) => (
              <label key={f.key} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={createForm.features[f.key]}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      features: { ...prev.features, [f.key]: e.target.checked },
                    }))
                  }
                />
                {f.label}
              </label>
            ))}
          </fieldset>
          <button type="submit" className={styles.submitButton} disabled={creating}>
            {creating ? 'Creating...' : 'Create user'}
          </button>
        </form>
      )}

      {users.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No users yet. Create the first user to get started.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Hourly rate</th>
                <th>Features</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.id === actorId ? styles.selfRow : ''}>
                  <td>
                    <div className={styles.userName}>{u.name}</div>
                    <div className={styles.userEmail}>{u.email}</div>
                    {u.id === actorId && <span className={styles.selfBadge}>You</span>}
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={u.role}
                      disabled={savingUserId === u.id}
                      onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                      aria-label={`Role for ${u.email}`}
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={u.status}
                      disabled={savingUserId === u.id}
                      onChange={(e) => handleStatusChange(u, e.target.value as UserStatus)}
                      aria-label={`Status for ${u.email}`}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={styles.input}
                      value={rateValues[u.id] ?? String(u.hourlyRate)}
                      disabled={savingUserId === u.id}
                      onChange={(e) => setRateValues((prev) => ({ ...prev, [u.id]: e.target.value }))}
                      onBlur={() => {
                        if (Number(rateValues[u.id]) !== u.hourlyRate) handleHourlyRateSave(u);
                      }}
                      aria-label={`Hourly rate for ${u.email}`}
                    />
                  </td>
                  <td>
                    <div className={styles.featureToggles}>
                      {FEATURES.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          className={u.features[f.key] ? styles.featureOn : styles.featureOff}
                          disabled={savingUserId === u.id}
                          onClick={() => handleToggleFeature(u, f.key, !u.features[f.key])}
                          aria-pressed={u.features[f.key]}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    {passwordResetFor === u.id ? (
                      <div className={styles.rowActions}>
                        <input
                          type="password"
                          autoComplete="new-password"
                          className={styles.input}
                          placeholder="New password (min 6)"
                          value={passwordValue}
                          onChange={(e) => setPasswordValue(e.target.value)}
                          aria-label={`New password for ${u.email}`}
                        />
                        <button
                          type="button"
                          className={styles.submitButton}
                          disabled={savingUserId === u.id}
                          onClick={() => handleResetPassword(u)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => {
                            setPasswordResetFor(null);
                            setPasswordValue('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => {
                            setPasswordResetFor(u.id);
                            setPasswordValue('');
                          }}
                        >
                          Reset password
                        </button>
                        <button type="button" className={styles.viewAsActionButton} onClick={() => handleViewAs(u)}>
                          View as
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
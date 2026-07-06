'use client';

import { useEffect, useState } from 'react';
import styles from './profile.module.css';

interface ProfileUser {
  name: string;
  email: string;
  notificationEmail: string | null;
}

export default function ProfilePage() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [notificationEmail, setNotificationEmail] = useState('');
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationSaved, setNotificationSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then((res) => res.json())
      .then((body) => {
        setUser(body.user);
        setNotificationEmail(body.user.notificationEmail ?? '');
      });
  }, []);

  async function handleSaveNotificationEmail(e: React.FormEvent) {
    e.preventDefault();
    setNotificationSaving(true);
    setNotificationError(null);
    setNotificationSaved(false);
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationEmail }),
    });
    setNotificationSaving(false);
    if (!res.ok) {
      setNotificationError('Enter a valid email address.');
      return;
    }
    const body = await res.json();
    setUser(body.user);
    setNotificationSaved(true);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setPasswordSaving(true);
    const res = await fetch('/api/profile/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setPasswordSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setPasswordError(body?.error === 'incorrect current password' ? 'Current password is incorrect.' : 'Could not change password.');
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordSaved(true);
  }

  if (!user) return <p>Loading...</p>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Profile</h1>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Notification email</h2>
        <p className={styles.sectionHint}>
          Sent here when a client approves or declines a quote, or confirms/rejects a scheduling date. Leave blank to use your login email ({user.email}).
        </p>
        {notificationError && <div className={styles.error}>{notificationError}</div>}
        {notificationSaved && <div className={styles.success}>Saved.</div>}
        <form onSubmit={handleSaveNotificationEmail}>
          <div className={styles.field}>
            <label htmlFor="notificationEmail">Notification email</label>
            <input
              id="notificationEmail"
              type="email"
              className={styles.input}
              placeholder={user.email}
              value={notificationEmail}
              onChange={(e) => {
                setNotificationEmail(e.target.value);
                setNotificationSaved(false);
              }}
            />
          </div>
          <button type="submit" className={styles.button} disabled={notificationSaving}>
            {notificationSaving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Change password</h2>
        <p className={styles.sectionHint}>Signed in as {user.email}.</p>
        {passwordError && <div className={styles.error}>{passwordError}</div>}
        {passwordSaved && <div className={styles.success}>Password changed.</div>}
        <form onSubmit={handleChangePassword}>
          <div className={styles.field}>
            <label htmlFor="currentPassword">Current password</label>
            <input
              id="currentPassword"
              type="password"
              className={styles.input}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="newPassword">New password</label>
            <input
              id="newPassword"
              type="password"
              className={styles.input}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              type="password"
              className={styles.input}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <button type="submit" className={styles.button} disabled={passwordSaving}>
            {passwordSaving ? 'Saving...' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}

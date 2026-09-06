'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './profile.module.css';

interface ProfileUser {
  name: string;
  email: string;
  notificationEmail: string | null;
  hourlyRate: number;
  defaultServiceName: string;
}

interface CompanyProfile {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
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

  const [hourlyRate, setHourlyRate] = useState('0');
  const [hourlyRateSaving, setHourlyRateSaving] = useState(false);
  const [hourlyRateError, setHourlyRateError] = useState<string | null>(null);
  const [hourlyRateSaved, setHourlyRateSaved] = useState(false);
  const [defaultServiceName, setDefaultServiceName] = useState('');
  const [serviceNameSaving, setServiceNameSaving] = useState(false);
  const [serviceNameError, setServiceNameError] = useState<string | null>(null);
  const [serviceNameSaved, setServiceNameSaved] = useState(false);

  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companySaving, setCompanySaving] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companySaved, setCompanySaved] = useState(false);

  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then((res) => res.json())
      .then((body) => {
        setUser(body.user);
        setNotificationEmail(body.user.notificationEmail ?? '');
        setHourlyRate(String(body.user.hourlyRate ?? 0));
        setDefaultServiceName(body.user.defaultServiceName ?? '');
      });
    fetch('/api/company')
      .then((res) => res.json())
      .then((body) => {
        setCompany(body.company);
        setCompanyName(body.company.name ?? '');
        setCompanyPhone(body.company.phone ?? '');
        setCompanyEmail(body.company.email ?? '');
        setCompanyAddress(body.company.address ?? '');
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

  async function handleSaveCompany(e: React.FormEvent) {
    e.preventDefault();
    setCompanySaving(true);
    setCompanyError(null);
    setCompanySaved(false);
    const res = await fetch('/api/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: companyName, phone: companyPhone, email: companyEmail, address: companyAddress }),
    });
    setCompanySaving(false);
    if (!res.ok) {
      setCompanyError('Enter a valid email address.');
      return;
    }
    const body = await res.json();
    setCompany(body.company);
    setCompanySaved(true);
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setLogoError(null);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/company/logo', { method: 'POST', body: formData });
    setLogoUploading(false);
    if (logoInputRef.current) logoInputRef.current.value = '';
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setLogoError(body?.error ?? 'Could not upload logo.');
      return;
    }
    const body = await res.json();
    setCompany(body.company);
  }

  async function handleRemoveLogo() {
    setLogoUploading(true);
    setLogoError(null);
    const res = await fetch('/api/company/logo', { method: 'DELETE' });
    setLogoUploading(false);
    if (!res.ok) {
      setLogoError('Could not remove logo.');
      return;
    }
    const body = await res.json();
    setCompany(body.company);
  }

  async function handleSaveHourlyRate(e: React.FormEvent) {
    e.preventDefault();
    const rate = Number(hourlyRate);
    if (!Number.isFinite(rate) || rate < 0) {
      setHourlyRateError('Enter a valid non-negative hourly rate.');
      return;
    }
    setHourlyRateSaving(true);
    setHourlyRateError(null);
    setHourlyRateSaved(false);
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hourlyRate: rate }),
    });
    setHourlyRateSaving(false);
    if (!res.ok) {
      setHourlyRateError('Could not save hourly rate.');
      return;
    }
    const body = await res.json();
    setHourlyRate(String(body.user.hourlyRate ?? 0));
    setHourlyRateSaved(true);
  }

  async function handleSaveServiceName(e: React.FormEvent) {
    e.preventDefault();
    if (!defaultServiceName.trim()) {
      setServiceNameError('Enter a service name.');
      return;
    }
    setServiceNameSaving(true);
    setServiceNameError(null);
    setServiceNameSaved(false);
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultServiceName: defaultServiceName.trim() }),
    });
    setServiceNameSaving(false);
    if (!res.ok) {
      setServiceNameError('Could not save service name.');
      return;
    }
    const body = await res.json();
    setDefaultServiceName(body.user.defaultServiceName ?? '');
    setServiceNameSaved(true);
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

  if (!user || !company) return <p>Loading...</p>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Profile</h1>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Service provider details</h2>
        <p className={styles.sectionHint}>Shown to the client on every quote — this is your business&apos;s own name, phone, email, and address, not the client&apos;s.</p>
        {companyError && <div className={styles.error}>{companyError}</div>}
        {companySaved && <div className={styles.success}>Saved.</div>}

        <div className={styles.field}>
          <label>Logo</label>
          <div className={styles.logoRow}>
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Company logo" className={styles.logoPreview} />
            ) : (
              <div className={styles.logoPlaceholder}>No logo</div>
            )}
            <div className={styles.logoUpload}>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoChange}
                disabled={logoUploading}
                className={styles.fileInput}
              />
              {logoUploading && <p className={styles.sectionHint}>Uploading...</p>}
              {logoError && <div className={styles.error}>{logoError}</div>}
              {company.logoUrl && !logoUploading && (
                <button type="button" className={styles.removeLogoButton} onClick={handleRemoveLogo}>
                  Remove logo
                </button>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveCompany}>
          <div className={styles.field}>
            <label htmlFor="companyName">Name</label>
            <input id="companyName" className={styles.input} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="companyPhone">Phone</label>
            <input id="companyPhone" type="tel" className={styles.input} value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="companyEmail">Email</label>
            <input id="companyEmail" type="email" className={styles.input} value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="companyAddress">Address</label>
            <input id="companyAddress" className={styles.input} value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
          </div>
          <button type="submit" className={styles.button} disabled={companySaving}>
            {companySaving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Default hourly rate</h2>
        <p className={styles.sectionHint}>
          Used when new timesheet entries are created — each entry snapshots this value, so changing it does not affect existing entries.
        </p>
        {serviceNameError && <div className={styles.error}>{serviceNameError}</div>}
        {serviceNameSaved && <div className={styles.success}>Saved.</div>}
        <form onSubmit={handleSaveServiceName}>
          <div className={styles.field}>
            <label htmlFor="defaultServiceName">Service name</label>
            <input
              id="defaultServiceName"
              type="text"
              className={styles.input}
              value={defaultServiceName}
              onChange={(e) => {
                setDefaultServiceName(e.target.value);
                setServiceNameSaved(false);
              }}
              aria-describedby="defaultServiceNameHint"
              required
            />
            <p id="defaultServiceNameHint" className={styles.sectionHint}>
              The name of the service you provide, shown on invoices generated from timesheet entries.
            </p>
          </div>
          <button type="submit" className={styles.button} disabled={serviceNameSaving}>
            {serviceNameSaving ? 'Saving...' : 'Save service name'}
          </button>
        </form>
        {hourlyRateError && <div className={styles.error}>{hourlyRateError}</div>}
        {hourlyRateSaved && <div className={styles.success}>Saved.</div>}
        <form onSubmit={handleSaveHourlyRate}>
          <div className={styles.field}>
            <label htmlFor="hourlyRate">Hourly rate ($)</label>
            <input
              id="hourlyRate"
              type="number"
              step="0.01"
              min="0"
              className={styles.input}
              value={hourlyRate}
              onChange={(e) => {
                setHourlyRate(e.target.value);
                setHourlyRateSaved(false);
              }}
            />
          </div>
          <button type="submit" className={styles.button} disabled={hourlyRateSaving}>
            {hourlyRateSaving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Notification email</h2>
        <p className={styles.sectionHint}>
          Sent here when a client approves or declines a quote, or confirms/rejects a scheduling date. Leave blank to turn these notifications off entirely.
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

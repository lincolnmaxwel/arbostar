'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPhoneInput } from '@/lib/formatPhone';
import styles from './EditClientButton.module.css';

interface Client {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
}

export function EditClientButton({ client, className }: { client: Client; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email);
  const [phone, setPhone] = useState(client.phone ?? '');
  const [address, setAddress] = useState(client.address ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setName(client.name);
    setEmail(client.email);
    setPhone(client.phone ?? '');
    setAddress(client.address ?? '');
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/clients/${client.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone: phone || undefined, address: address || undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.message || 'Could not save changes.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" className={className} onClick={openModal}>
        Edit
      </button>

      {open && (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${client.name}`}
          onClick={() => !saving && setOpen(false)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.title}>Edit client</h2>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.field}>
              <label htmlFor="editClientName">Name</label>
              <input id="editClientName" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className={styles.field}>
              <label htmlFor="editClientEmail">Email</label>
              <input id="editClientEmail" className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className={styles.field}>
              <label htmlFor="editClientPhone">Phone</label>
              <input
                id="editClientPhone"
                className={styles.input}
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="editClientAddress">Address</label>
              <input id="editClientAddress" className={styles.input} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.saveButton}
                onClick={handleSave}
                disabled={saving || !name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteClientButton({ clientId, clientName, className }: { clientId: string; clientName: string; className?: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete ${clientName} and all their quotes? This can't be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
    setDeleting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      window.alert(body?.message || 'Could not delete this client.');
      return;
    }
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={handleDelete} disabled={deleting}>
      {deleting ? 'Deleting...' : 'Delete'}
    </button>
  );
}

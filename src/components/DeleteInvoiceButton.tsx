'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteInvoiceButton({
  invoiceId,
  invoiceNumber,
  className,
  redirectTo,
}: {
  invoiceId: string;
  invoiceNumber: number;
  className?: string;
  // From the detail page, refresh() alone would re-render straight into a
  // 404 (the invoice it was showing no longer exists) — redirect to the
  // list instead.
  redirectTo?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete invoice #${invoiceNumber}? This can't be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' });
    setDeleting(false);
    if (!res.ok) {
      window.alert('Could not delete this invoice.');
      return;
    }
    if (redirectTo) {
      router.push(redirectTo);
    } else {
      router.refresh();
    }
  }

  return (
    <button type="button" className={className} onClick={handleDelete} disabled={deleting}>
      {deleting ? 'Deleting...' : 'Delete'}
    </button>
  );
}

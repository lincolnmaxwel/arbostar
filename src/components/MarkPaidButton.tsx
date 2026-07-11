'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InvoicePaymentStatus } from '@/lib/paymentStatusLabel';

export function MarkPaidButton({
  invoiceId,
  invoiceNumber,
  paymentStatus,
  className,
}: {
  invoiceId: string;
  invoiceNumber: number;
  paymentStatus: InvoicePaymentStatus;
  className?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Marking paid is a one-way door — the client already gets a "payment
  // received" email the moment this succeeds, so there's no "mark as
  // pending" to offer back. Once paid, this button just disappears.
  if (paymentStatus === 'paid') return null;

  async function handleClick() {
    if (!window.confirm(`Mark invoice #${invoiceNumber} as paid? This can't be undone.`)) return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: 'paid' }),
    });
    setSaving(false);
    if (!res.ok) {
      window.alert('Could not update payment status.');
      return;
    }
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={handleClick} disabled={saving}>
      {saving ? 'Saving...' : 'Mark as paid'}
    </button>
  );
}

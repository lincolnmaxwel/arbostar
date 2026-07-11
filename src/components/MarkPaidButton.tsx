'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InvoicePaymentStatus } from '@/lib/paymentStatusLabel';

export function MarkPaidButton({
  invoiceId,
  paymentStatus,
  className,
}: {
  invoiceId: string;
  paymentStatus: InvoicePaymentStatus;
  className?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const next: InvoicePaymentStatus = paymentStatus === 'paid' ? 'pending' : 'paid';

  async function handleClick() {
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: next }),
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
      {saving ? 'Saving...' : next === 'paid' ? 'Mark as paid' : 'Mark as pending'}
    </button>
  );
}

import { InvoicePaymentStatus, getPaymentStatusLabel } from '@/lib/paymentStatusLabel';

const STYLES: Record<InvoicePaymentStatus, React.CSSProperties> = {
  pending: { background: '#fef9e7', color: '#b58900', border: '1px solid #f0d97a' },
  paid: { background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #a0e0d5' },
};

export function PaymentStatusBadge({ status }: { status: InvoicePaymentStatus }) {
  return (
    <span
      data-testid="payment-status-badge"
      style={{
        ...STYLES[status],
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 700,
        lineHeight: 1.4,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      {getPaymentStatusLabel(status)}
    </span>
  );
}

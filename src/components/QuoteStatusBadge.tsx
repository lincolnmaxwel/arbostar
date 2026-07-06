import { getQuoteStatusLabel, ApprovalStatus, BookingStatus, QuoteStatusVariant } from '@/lib/quoteStatusLabel';

const STYLES: Record<QuoteStatusVariant, React.CSSProperties> = {
  draft: { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' },
  pendingApproval: { background: '#fef9e7', color: '#b58900', border: '1px solid #f0d97a' },
  approved: { background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #a0e0d5' },
  declined: { background: 'var(--color-error-bg)', color: 'var(--color-error)', border: '1px solid #f5a5a5' },
  expired: { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' },
  pendingScheduling: { background: '#eef2fa', color: '#268bd2', border: '1px solid #a0c4f0' },
  schedulingDeclined: { background: 'var(--color-error-bg)', color: 'var(--color-error)', border: '1px solid #f5a5a5' },
  scheduled: { background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #a0e0d5' },
};

export function QuoteStatusBadge({ approvalStatus, bookingStatus }: { approvalStatus?: ApprovalStatus; bookingStatus?: BookingStatus }) {
  const { label, variant } = getQuoteStatusLabel(approvalStatus, bookingStatus);
  return (
    <span
      data-testid="quote-status-badge"
      style={{
        ...STYLES[variant],
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      {label}
    </span>
  );
}

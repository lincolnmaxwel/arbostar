type Status = 'local' | 'syncing' | 'synced' | 'error';

const LABELS: Record<Status, string> = {
  local: 'Local',
  syncing: 'Syncing...',
  synced: 'Synced',
  error: 'Sync error',
};

const STYLES: Record<Status, React.CSSProperties> = {
  local: { background: '#fef9e7', color: '#b58900', border: '1px solid #f0d97a' },
  syncing: { background: '#eef2fa', color: '#268bd2', border: '1px solid #a0c4f0' },
  synced: { background: '#f0fdf9', color: '#2aa198', border: '1px solid #a0e0d5' },
  error: { background: '#fef2f2', color: '#dc322f', border: '1px solid #f5a5a5' },
};

export function SyncStatusBadge({ status }: { status: Status }) {
  return (
    <span
      data-testid="sync-badge"
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
      {LABELS[status]}
    </span>
  );
}

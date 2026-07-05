type Status = 'local' | 'syncing' | 'synced' | 'error';

const LABELS: Record<Status, string> = {
  local: 'Local',
  syncing: 'Syncing...',
  synced: 'Synced',
  error: 'Sync error',
};

const COLORS: Record<Status, string> = {
  local: '#b58900',
  syncing: '#268bd2',
  synced: '#2aa198',
  error: '#dc322f',
};

export function SyncStatusBadge({ status }: { status: Status }) {
  return (
    <span style={{ color: COLORS[status], fontWeight: 600 }} data-testid="sync-badge">
      {LABELS[status]}
    </span>
  );
}

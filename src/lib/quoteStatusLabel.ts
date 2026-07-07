export type ApprovalStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'expired' | 'scheduled' | 'completed';
export type BookingStatus = 'idle' | 'proposed' | 'rejected' | 'confirmed';

export type QuoteStatusVariant =
  | 'draft'
  | 'pendingApproval'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'pendingScheduling'
  | 'schedulingDeclined'
  | 'scheduled'
  | 'completed';

// The quote's business status — where it stands with the CLIENT (pending
// their approval, or their scheduling response) vs where it stands
// internally (draft, approved and awaiting a proposed date). Distinct from
// sync status (local/syncing/synced/error), which only describes whether
// this device's copy has reached the server yet.
export function getQuoteStatusLabel(
  approvalStatus: ApprovalStatus | undefined,
  bookingStatus: BookingStatus | undefined,
): { label: string; variant: QuoteStatusVariant } {
  if (!approvalStatus || approvalStatus === 'draft') return { label: 'Draft', variant: 'draft' };
  if (approvalStatus === 'sent') return { label: 'Pending approval', variant: 'pendingApproval' };
  if (approvalStatus === 'declined') return { label: 'Declined', variant: 'declined' };
  if (approvalStatus === 'expired') return { label: 'Expired', variant: 'expired' };
  if (approvalStatus === 'scheduled') return { label: 'Scheduled', variant: 'scheduled' };
  if (approvalStatus === 'completed') return { label: 'Completed', variant: 'completed' };

  // approvalStatus === 'approved' — refine by where it stands on booking.
  if (bookingStatus === 'proposed') return { label: 'Pending scheduling', variant: 'pendingScheduling' };
  if (bookingStatus === 'rejected') return { label: 'Scheduling declined', variant: 'schedulingDeclined' };
  return { label: 'Approved', variant: 'approved' };
}

const SYNC_STATUS_LABELS: Record<'local' | 'syncing' | 'synced' | 'error', string> = {
  local: 'Local',
  syncing: 'Syncing...',
  synced: 'Synced',
  error: 'Sync error',
};

// The exact text shown in the Status column for a given draft — used by the
// Quotes list search so typing a status word ("approved", "pending", "local")
// matches the same thing the user sees, whichever badge is actually showing.
export function getDraftDisplayStatus(draft: {
  pendingDelete?: boolean;
  status: 'local' | 'syncing' | 'synced' | 'error';
  approvalStatus?: ApprovalStatus;
  bookingStatus?: BookingStatus;
}): string {
  if (draft.pendingDelete) return 'Queued for deletion';
  if (draft.status !== 'synced') return SYNC_STATUS_LABELS[draft.status];
  return getQuoteStatusLabel(draft.approvalStatus, draft.bookingStatus).label;
}

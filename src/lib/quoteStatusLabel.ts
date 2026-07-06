export type ApprovalStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'expired' | 'scheduled';
export type BookingStatus = 'idle' | 'proposed' | 'rejected' | 'confirmed';

export type QuoteStatusVariant =
  | 'draft'
  | 'pendingApproval'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'pendingScheduling'
  | 'schedulingDeclined'
  | 'scheduled';

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

  // approvalStatus === 'approved' — refine by where it stands on booking.
  if (bookingStatus === 'proposed') return { label: 'Pending scheduling', variant: 'pendingScheduling' };
  if (bookingStatus === 'rejected') return { label: 'Scheduling declined', variant: 'schedulingDeclined' };
  return { label: 'Approved', variant: 'approved' };
}

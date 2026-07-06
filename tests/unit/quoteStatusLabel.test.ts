import { describe, it, expect } from 'vitest';
import { getQuoteStatusLabel } from '@/lib/quoteStatusLabel';

describe('getQuoteStatusLabel', () => {
  it('defaults to Draft when approvalStatus is undefined or draft', () => {
    expect(getQuoteStatusLabel(undefined, undefined)).toEqual({ label: 'Draft', variant: 'draft' });
    expect(getQuoteStatusLabel('draft', undefined)).toEqual({ label: 'Draft', variant: 'draft' });
  });

  it('shows Pending approval while sent to the client, awaiting their decision', () => {
    expect(getQuoteStatusLabel('sent', 'idle')).toEqual({ label: 'Pending approval', variant: 'pendingApproval' });
  });

  it('shows Declined when the client declines', () => {
    expect(getQuoteStatusLabel('declined', 'idle')).toEqual({ label: 'Declined', variant: 'declined' });
  });

  it('shows Expired', () => {
    expect(getQuoteStatusLabel('expired', 'idle')).toEqual({ label: 'Expired', variant: 'expired' });
  });

  it('shows Scheduled once the quote itself has moved to scheduled', () => {
    expect(getQuoteStatusLabel('scheduled', 'confirmed')).toEqual({ label: 'Scheduled', variant: 'scheduled' });
  });

  it('shows Approved when approved and no scheduling round has been proposed yet', () => {
    expect(getQuoteStatusLabel('approved', 'idle')).toEqual({ label: 'Approved', variant: 'approved' });
    expect(getQuoteStatusLabel('approved', undefined)).toEqual({ label: 'Approved', variant: 'approved' });
  });

  it('shows Pending scheduling once staff proposes dates and awaits the client', () => {
    expect(getQuoteStatusLabel('approved', 'proposed')).toEqual({ label: 'Pending scheduling', variant: 'pendingScheduling' });
  });

  it('shows Scheduling declined when the client rejects the proposed dates', () => {
    expect(getQuoteStatusLabel('approved', 'rejected')).toEqual({ label: 'Scheduling declined', variant: 'schedulingDeclined' });
  });
});

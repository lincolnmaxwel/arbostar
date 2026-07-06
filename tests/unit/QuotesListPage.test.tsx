// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import QuotesListPage from '@/app/quotes/page';
import { localDb } from '@/lib/localDb';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('QuotesListPage', () => {
  afterEach(cleanup);

  beforeEach(async () => {
    await localDb.drafts.clear();
  });

  it('shows the sync status for a draft not yet synced to the server', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'Nelson Costa', clientEmail: 'n@x.com', items: [], taxRate: 0.05, status: 'local', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Nelson Costa')).toBeInTheDocument());
    expect(screen.getByTestId('sync-badge')).toHaveTextContent('Local');
  });

  it('shows the quote\'s business status, not "Synced", once it has synced', async () => {
    await localDb.drafts.put({
      draftId: 'd2', serverId: 'server-2', clientName: 'Maria Silva', clientEmail: 'm@x.com', items: [], taxRate: 0.05,
      status: 'synced', approvalStatus: 'sent', bookingStatus: 'idle', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Maria Silva')).toBeInTheDocument());
    expect(screen.queryByTestId('sync-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('quote-status-badge')).toHaveTextContent('Pending approval');
  });

  it('shows "Pending scheduling" for an approved quote with a proposed round awaiting the client', async () => {
    await localDb.drafts.put({
      draftId: 'd3', serverId: 'server-3', clientName: 'Approved Client', clientEmail: 'a@x.com', items: [], taxRate: 0.05,
      status: 'synced', approvalStatus: 'approved', bookingStatus: 'proposed', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Approved Client')).toBeInTheDocument());
    expect(screen.getByTestId('quote-status-badge')).toHaveTextContent('Pending scheduling');
  });

  it('filters by name, phone, address, email, and status', async () => {
    await localDb.drafts.put({
      draftId: 'd4', serverId: 'server-4', clientName: 'Nelson Costa', clientEmail: 'nelson@x.com',
      clientPhone: '(555) 123-4567', clientAddress: '1 Main St', serviceAddress: '99 Oak Ave',
      items: [], taxRate: 0.05, status: 'synced', approvalStatus: 'sent', bookingStatus: 'idle', updatedAt: Date.now(),
    });
    await localDb.drafts.put({
      draftId: 'd5', serverId: 'server-5', clientName: 'Maria Silva', clientEmail: 'maria@x.com',
      clientPhone: '(555) 999-0000', items: [], taxRate: 0.05, status: 'synced', approvalStatus: 'approved', bookingStatus: 'idle', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Nelson Costa')).toBeInTheDocument());
    const search = screen.getByLabelText('Search quotes');

    fireEvent.change(search, { target: { value: 'oak ave' } });
    expect(screen.getByText('Nelson Costa')).toBeInTheDocument();
    expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '999-0000' } });
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.queryByText('Nelson Costa')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'pending approval' } });
    expect(screen.getByText('Nelson Costa')).toBeInTheDocument();
    expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'no such client' } });
    expect(screen.getByText(/No quotes match/)).toBeInTheDocument();
  });
});

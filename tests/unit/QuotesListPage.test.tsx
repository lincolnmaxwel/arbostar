// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import QuotesListPage from '@/app/quotes/page';
import { localDb } from '@/lib/localDb';
import { resetViewContext } from '@/lib/clientUserContext';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const OWNER = 'user-a';

function viewContextResponse() {
  return {
    ok: true,
    json: async () => ({
      actorUserId: OWNER,
      actorRole: 'staff',
      ownerUserId: OWNER,
      isViewAs: false,
      targetName: null,
      features: { quotes: true, invoices: true, timesheet: true, clients_crm: true },
    }),
  };
}

describe('QuotesListPage', () => {
  afterEach(cleanup);

  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
    await localDb.pendingDeletes.clear();
    resetViewContext();
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/view-context') return viewContextResponse() as Response;
      if (url === '/api/quotes') {
        // Echo seeded synced drafts back as server quotes so the mount-time
        // pullServerQuotes() doesn't treat them as "deleted on another device".
        const drafts = await localDb.drafts.toArray();
        return {
          ok: true,
          json: async () => ({
            quotes: drafts
              .filter((d) => d.serverId)
              .map((d) => ({
                id: d.serverId,
                draftId: d.draftId,
                client: { name: d.clientName, email: d.clientEmail },
                taxRate: '0.05',
                items: [],
                status: d.approvalStatus ?? 'draft',
                bookingStatus: d.bookingStatus ?? 'idle',
                updatedAt: new Date(d.updatedAt).toISOString(),
              })),
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ quotes: [] }) } as Response;
    }) as any;
  });

  it('shows the sync status for a draft not yet synced to the server', async () => {
    await localDb.drafts.put({
      draftId: 'd1', ownerUserId: OWNER, clientName: 'Nelson Costa', clientEmail: 'n@x.com', items: [], taxRate: 0.05, status: 'local', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Nelson Costa')).toBeInTheDocument());
    expect(screen.getByTestId('sync-badge')).toHaveTextContent('Local');
  });

  it('shows the quote\'s business status, not "Synced", once it has synced', async () => {
    await localDb.drafts.put({
      draftId: 'd2', ownerUserId: OWNER, serverId: 'server-2', clientName: 'Maria Silva', clientEmail: 'm@x.com', items: [], taxRate: 0.05,
      status: 'synced', approvalStatus: 'sent', bookingStatus: 'idle', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Maria Silva')).toBeInTheDocument());
    expect(screen.queryByTestId('sync-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('quote-status-badge')).toHaveTextContent('Pending approval');
  });

  it('shows "Pending scheduling" for an approved quote with a proposed round awaiting the client', async () => {
    await localDb.drafts.put({
      draftId: 'd3', ownerUserId: OWNER, serverId: 'server-3', clientName: 'Approved Client', clientEmail: 'a@x.com', items: [], taxRate: 0.05,
      status: 'synced', approvalStatus: 'approved', bookingStatus: 'proposed', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Approved Client')).toBeInTheDocument());
    expect(screen.getByTestId('quote-status-badge')).toHaveTextContent('Pending scheduling');
  });

  it('filters by name, phone, address, email, and status', async () => {
    await localDb.drafts.put({
      draftId: 'd4', ownerUserId: OWNER, serverId: 'server-4', clientName: 'Nelson Costa', clientEmail: 'nelson@x.com',
      clientPhone: '(555) 123-4567', clientAddress: '1 Main St', serviceAddress: '99 Oak Ave',
      items: [], taxRate: 0.05, status: 'synced', approvalStatus: 'sent', bookingStatus: 'idle', updatedAt: Date.now(),
    });
    await localDb.drafts.put({
      draftId: 'd5', ownerUserId: OWNER, serverId: 'server-5', clientName: 'Maria Silva', clientEmail: 'maria@x.com',
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

  it('shows only the current owner\'s drafts when two users share this browser', async () => {
    await localDb.drafts.put({
      draftId: 'mine', ownerUserId: OWNER, clientName: 'My Client', clientEmail: 'mine@x.com', items: [], taxRate: 0.05, status: 'local', updatedAt: Date.now(),
    });
    await localDb.drafts.put({
      draftId: 'theirs', ownerUserId: 'user-b', clientName: 'Their Client', clientEmail: 'theirs@x.com', items: [], taxRate: 0.05, status: 'local', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('My Client')).toBeInTheDocument());
    expect(screen.queryByText('Their Client')).not.toBeInTheDocument();
  });
});
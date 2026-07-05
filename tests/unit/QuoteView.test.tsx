// tests/unit/QuoteView.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QuoteView } from '@/components/QuoteView';
import { localDb } from '@/lib/localDb';

// jsdom doesn't implement createObjectURL/revokeObjectURL.
let mockUrlCounter = 0;
global.URL.createObjectURL = vi.fn(() => `blob:mock/${mockUrlCounter++}`);
global.URL.revokeObjectURL = vi.fn();

describe('QuoteView', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.photos.clear();
  });

  it('renders client details, line items, and computed totals', async () => {
    await localDb.drafts.put({
      draftId: 'view-1',
      clientName: 'Nelson Costa',
      clientEmail: 'nelson@example.com',
      clientPhone: '(250) 216-1006',
      taxRate: 0.05,
      status: 'synced',
      updatedAt: Date.now(),
      items: [
        { id: 'i1', title: 'Hedges', description: 'Trim the top', price: 1250, photoIds: [] },
        { id: 'i2', title: 'Hedges', price: 500, photoIds: [] },
      ],
    });

    render(<QuoteView draftId="view-1" />);

    await waitFor(() => expect(screen.getByText('Nelson Costa')).toBeInTheDocument());
    expect(screen.getByText('(250) 216-1006')).toBeInTheDocument();
    expect(screen.getByText('Trim the top')).toBeInTheDocument();
    expect(screen.getByText('$1750.00')).toBeInTheDocument(); // subtotal
    expect(screen.getByText('$87.50')).toBeInTheDocument(); // tax
    expect(screen.getByText('$1837.50')).toBeInTheDocument(); // total
    expect(screen.getByTestId('sync-badge')).toHaveTextContent('Synced');
  });

  it('shows an empty-items message when the quote has no services yet', async () => {
    await localDb.drafts.put({
      draftId: 'view-2',
      clientName: 'Empty Client',
      clientEmail: 'empty@example.com',
      taxRate: 0.05,
      status: 'local',
      updatedAt: Date.now(),
      items: [],
    });

    render(<QuoteView draftId="view-2" />);

    await waitFor(() => expect(screen.getByText('No services added yet.')).toBeInTheDocument());
  });

  it('opens a photo in a lightbox on click, and navigates between attached photos', async () => {
    await localDb.photos.add({ id: 'p1', draftId: 'view-3', blob: new Blob(['a']), fileName: 'a.jpg', status: 'uploaded' });
    await localDb.photos.add({ id: 'p2', draftId: 'view-3', blob: new Blob(['b']), fileName: 'b.jpg', status: 'uploaded' });
    await localDb.drafts.put({
      draftId: 'view-3',
      clientName: 'Photo Client',
      clientEmail: 'photo@example.com',
      taxRate: 0.05,
      status: 'synced',
      updatedAt: Date.now(),
      items: [{ id: 'i1', title: 'Hedges', price: 100, photoIds: ['p1', 'p2'] }],
    });

    render(<QuoteView draftId="view-3" />);

    const thumbButtons = await screen.findAllByLabelText('View photo for Hedges');
    expect(thumbButtons).toHaveLength(2);
    fireEvent.click(thumbButtons[0]);

    expect(screen.getByTestId('photo-lightbox')).toBeInTheDocument();
    expect(screen.getByText('Hedges — 1 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByText('Hedges — 2 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('photo-lightbox')).not.toBeInTheDocument();
  });

  it('fetches and shows the approval status, and copies the client link', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ quote: { status: 'sent', publicToken: 'token-abc-123' } }),
    });

    await localDb.drafts.put({
      draftId: 'view-4',
      serverId: 'server-quote-4',
      clientName: 'Approval Client',
      clientEmail: 'approval@example.com',
      taxRate: 0.05,
      status: 'synced',
      updatedAt: Date.now(),
      items: [],
    });

    render(<QuoteView draftId="view-4" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/quotes/server-quote-4'));
    await waitFor(() => expect(screen.getByTestId('approval-badge')).toHaveTextContent('Pending client approval'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy client link' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/portal/token-abc-123'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link copied!' })).toBeInTheDocument());
  });
});

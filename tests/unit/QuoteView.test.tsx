// tests/unit/QuoteView.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QuoteView } from '@/components/QuoteView';
import { localDb } from '@/lib/localDb';

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
});

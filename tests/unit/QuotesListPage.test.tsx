// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import QuotesListPage from '@/app/quotes/page';
import { localDb } from '@/lib/localDb';

describe('QuotesListPage', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
  });

  it('lists drafts with their sync status', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'Nelson Costa', clientEmail: 'n@x.com', items: [], taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Nelson Costa')).toBeInTheDocument());
    expect(screen.getByTestId('sync-badge')).toHaveTextContent('Synced');
  });
});

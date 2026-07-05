// tests/unit/QuoteBuilderForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';
import { localDb } from '@/lib/localDb';

describe('QuoteBuilderForm', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
  });

  it('autosaves the client name locally after the debounce window', async () => {
    const draftId = 'test-draft-1';
    render(<QuoteBuilderForm draftId={draftId} />);
    await screen.findByLabelText('Client name');
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Nelson Costa' } });

    await waitFor(
      async () => {
        const saved = await localDb.drafts.get(draftId);
        expect(saved?.clientName).toBe('Nelson Costa');
      },
      { timeout: 2000 },
    );
  });

  it('shows the Local badge for a freshly created draft', async () => {
    render(<QuoteBuilderForm draftId="test-draft-2" />);
    await waitFor(() => expect(screen.getByTestId('sync-badge')).toHaveTextContent('Local'));
  });
});

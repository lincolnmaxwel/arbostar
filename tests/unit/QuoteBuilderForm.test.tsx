// tests/unit/QuoteBuilderForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';
import { localDb } from '@/lib/localDb';
import { enqueueSync, markStuck, getEntryForDraft } from '@/lib/outbox';

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

  it('shows a sync-error banner with Retry/Discard when the outbox entry is stuck', async () => {
    const draftId = 'test-draft-3';
    await localDb.drafts.put({
      draftId, clientName: 'Stuck Client', clientEmail: 'x@x.com', items: [], taxRate: 0.05, status: 'error', updatedAt: Date.now(),
    });
    await enqueueSync(draftId);
    const entry = await getEntryForDraft(draftId);
    await markStuck(entry!.id!, 'sync failed: HTTP 409');

    render(<QuoteBuilderForm draftId={draftId} />);

    await waitFor(() => expect(screen.getByTestId('conflict-banner')).toHaveTextContent('sync failed: HTTP 409'));

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));

    await waitFor(async () => {
      const draft = await localDb.drafts.get(draftId);
      expect(draft?.status).toBe('local');
      expect(await getEntryForDraft(draftId)).toBeUndefined();
    });
  });
});

// tests/unit/QuoteBuilderForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/compressImage', () => ({ compressImage: async (blob: Blob) => blob }));

import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';
import { localDb } from '@/lib/localDb';
import { enqueueSync, markStuck, getEntryForDraft } from '@/lib/outbox';

describe('QuoteBuilderForm', () => {
  afterEach(cleanup);

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

  it('lets staff attach a photo to a service line item', async () => {
    const draftId = 'test-draft-4';
    render(<QuoteBuilderForm draftId={draftId} />);
    await screen.findByLabelText('Client name');
    fireEvent.click(screen.getByRole('button', { name: /add service/i }));

    const draft = await waitFor(async () => {
      const d = await localDb.drafts.get(draftId);
      if (!d || d.items.length === 0) throw new Error('item not added yet');
      return d;
    });
    const itemId = draft.items[0].id;

    const file = new File(['fake-bytes'], 'hedge.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText('+ Attach photo');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId(`photo-count-${itemId}`)).toHaveTextContent('1 photo'));
  });

  it('preserves serverId/serverItemId when editing a field after the quote has already synced', async () => {
    const draftId = 'test-draft-5';
    await localDb.drafts.put({
      draftId,
      serverId: 'server-quote-5',
      clientName: 'Nelson Costa',
      clientEmail: 'nelson@example.com',
      taxRate: 0.05,
      status: 'synced',
      updatedAt: Date.now(),
      items: [{ id: 'item-5', serverItemId: 'server-item-5', title: 'Hedges', price: 100, photoIds: [] }],
    });

    render(<QuoteBuilderForm draftId={draftId} />);
    await screen.findByLabelText('Client name');

    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Nelson Costa Jr.' } });

    await waitFor(
      async () => {
        const saved = await localDb.drafts.get(draftId);
        expect(saved?.clientName).toBe('Nelson Costa Jr.');
        expect(saved?.serverId).toBe('server-quote-5');
        expect(saved?.items[0].serverItemId).toBe('server-item-5');
      },
      { timeout: 2000 },
    );
  });
});

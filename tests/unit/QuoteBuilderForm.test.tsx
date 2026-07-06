// tests/unit/QuoteBuilderForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/compressImage', () => ({ compressImage: async (blob: Blob) => blob }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let mockUrlCounter = 0;
global.URL.createObjectURL = vi.fn(() => `blob:mock/${mockUrlCounter++}`) as any;
global.URL.revokeObjectURL = vi.fn();

import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';
import { localDb } from '@/lib/localDb';
import { enqueueSync, markStuck, getEntryForDraft } from '@/lib/outbox';

describe('QuoteBuilderForm', () => {
  afterEach(cleanup);

  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
    // submit() checks real connectivity (isReallyOnline(), a HEAD to
    // /api/health) before deciding whether to mark the draft 'syncing' and
    // navigate — these tests exercise the "online" path, so answer that
    // check the same way the sync worker's own tests do.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
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

  it('does not create a row in localDb.drafts just from opening the builder untouched', async () => {
    render(<QuoteBuilderForm draftId="test-draft-untouched" />);
    await screen.findByLabelText('Client name');

    // give any accidental eager write a chance to land before asserting its absence
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await localDb.drafts.get('test-draft-untouched')).toBeUndefined();
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

  it('lets staff select and attach multiple photos to a line item in one go', async () => {
    const draftId = 'test-draft-multi-photo';
    render(<QuoteBuilderForm draftId={draftId} />);
    await screen.findByLabelText('Client name');
    fireEvent.click(screen.getByRole('button', { name: /add service/i }));

    const draft = await waitFor(async () => {
      const d = await localDb.drafts.get(draftId);
      if (!d || d.items.length === 0) throw new Error('item not added yet');
      return d;
    });
    const itemId = draft.items[0].id;

    const input = screen.getByLabelText('+ Attach photo') as HTMLInputElement;
    expect(input.multiple).toBe(true);

    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [fileA, fileB] } });

    await waitFor(() => expect(screen.getByTestId(`photo-count-${itemId}`)).toHaveTextContent('2 photo'));

    await waitFor(
      async () => {
        const saved = await localDb.drafts.get(draftId);
        expect(saved?.items[0].photoIds).toHaveLength(2);
      },
      { timeout: 2000 },
    );
  });

  it('lets staff remove a service line item', async () => {
    const draftId = 'test-draft-remove-item';
    render(<QuoteBuilderForm draftId={draftId} />);
    await screen.findByLabelText('Client name');
    fireEvent.click(screen.getByRole('button', { name: /add service/i }));

    await waitFor(async () => {
      const d = await localDb.drafts.get(draftId);
      expect(d?.items).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(async () => {
      const d = await localDb.drafts.get(draftId);
      expect(d?.items).toHaveLength(0);
    });
    expect(screen.queryByLabelText('Service title')).not.toBeInTheDocument();
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

  async function fillValidQuote(draftId: string) {
    render(<QuoteBuilderForm draftId={draftId} />);
    await screen.findByLabelText('Client name');
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Nelson Costa' } });
    fireEvent.change(screen.getByLabelText('Client email'), { target: { value: 'nelson@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /add service/i }));
    await waitFor(async () => {
      const d = await localDb.drafts.get(draftId);
      expect(d?.items).toHaveLength(1);
    });
    fireEvent.change(screen.getByLabelText('Service title'), { target: { value: 'Hedges' } });
  }

  it('Save persists without requesting an email', async () => {
    const draftId = 'test-draft-save-only';
    await fillValidQuote(draftId);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      const draft = await localDb.drafts.get(draftId);
      expect(draft?.status).toBe('syncing');
      expect(draft?.pendingSend).toBe(false);
    });
  });

  it('Save and Send marks the draft with pendingSend for the sync worker to act on', async () => {
    const draftId = 'test-draft-save-and-send';
    await fillValidQuote(draftId);

    fireEvent.click(screen.getByRole('button', { name: 'Save and Send' }));

    await waitFor(async () => {
      const draft = await localDb.drafts.get(draftId);
      expect(draft?.status).toBe('syncing');
      expect(draft?.pendingSend).toBe(true);
    });
  });
});

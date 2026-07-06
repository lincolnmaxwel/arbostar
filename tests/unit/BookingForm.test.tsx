// tests/unit/BookingForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { BookingForm } from '@/components/BookingForm';

const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, refresh: vi.fn() }),
}));

function mockFetchOnce(responses: Array<{ ok?: boolean; status?: number; json?: () => Promise<unknown> }>) {
  const calls = [...responses];
  global.fetch = vi.fn(() => {
    const next = calls.shift() ?? { ok: true, json: async () => ({}) };
    return Promise.resolve(next as any);
  }) as unknown as typeof fetch;
}

describe('BookingForm', () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders one empty date+window row by default and an "Add date" button', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByLabelText(/date/i)).toBeInTheDocument());
    expect(screen.getAllByLabelText(/date/i)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /add date/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send to client/i })).toBeDisabled();
  });

  it('caps at 3 rows and disables "Add date" when 3 exist', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: /add date/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add date/i }));
    fireEvent.click(screen.getByRole('button', { name: /add date/i }));

    expect(screen.getAllByLabelText(/date/i)).toHaveLength(3);
    expect(screen.getByRole('button', { name: /add date/i })).toBeDisabled();
  });

  it('shows the latest rejection reason when bookingStatus=rejected', async () => {
    mockFetchOnce([
      {
        ok: true,
        json: async () => ({
          quote: { id: 'q1', status: 'approved', bookingStatus: 'rejected' },
          latestRound: {
            id: 'r1',
            roundNumber: 1,
            status: 'rejected',
            rejectionReason: 'Those days are all bad.',
            proposedAt: '2099-01-01T00:00:00.000Z',
            respondedAt: '2099-01-02T00:00:00.000Z',
            options: [{ id: 'o1', proposedDate: '2099-07-15', window: 'morning', chosen: false }],
          },
        }),
      },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByText(/those days are all bad/i)).toBeInTheDocument());
  });

  it('blocks submit on a past date with a validation error', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    const dateInput = (await screen.findByLabelText(/date/i)) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText(/window/i), { target: { value: 'morning' } });

    await waitFor(() => expect(screen.getByRole('button', { name: /send to client/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));

    await waitFor(() => expect(screen.getByText(/past date/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the GET, not a POST
  });

  it('blocks submit on duplicate {date, window} rows', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: /add date/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add date/i }));

    const dateInputs = screen.getAllByLabelText(/date/i);
    const future = '2099-07-15';
    fireEvent.change(dateInputs[0], { target: { value: future } });
    fireEvent.change(dateInputs[1], { target: { value: future } });
    const windowSelects = screen.getAllByLabelText(/window/i);
    fireEvent.change(windowSelects[0], { target: { value: 'morning' } });
    fireEvent.change(windowSelects[1], { target: { value: 'morning' } });

    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    await waitFor(() => expect(screen.getByText(/duplicate/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1); // still only the GET
  });

  it('submits valid options and redirects back to the quote view on success', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
      { ok: true, status: 201, json: async () => ({ roundId: 'r1' }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    const dateInput = await screen.findByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2099-07-15' } });
    fireEvent.change(screen.getByLabelText(/window/i), { target: { value: 'morning' } });

    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/quotes/d1'));
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/quotes/q1/booking/round',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders a "round already active" banner on 409', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
      { ok: false, status: 409, json: async () => ({ error: 'round-already-active' }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    const dateInput = await screen.findByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2099-07-15' } });
    fireEvent.change(screen.getByLabelText(/window/i), { target: { value: 'morning' } });
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));

    await waitFor(() => expect(screen.getByText(/round already active/i)).toBeInTheDocument());
  });
});

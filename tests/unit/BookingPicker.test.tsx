// tests/unit/BookingPicker.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { BookingPicker } from '@/components/BookingPicker';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const options = [
  { id: 'o1', proposedDate: '2099-07-15', window: 'morning' as const, chosen: false },
  { id: 'o2', proposedDate: '2099-07-17', window: 'fullday' as const, chosen: false },
];

describe('BookingPicker', () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });

  afterEach(cleanup);

  it('renders one radio card per option', () => {
    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    expect(screen.getByLabelText(/july 15, 2099/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/july 17, 2099/i)).toBeInTheDocument();
    expect(screen.getByText(/morning/i)).toBeInTheDocument();
    expect(screen.getByText(/full day/i)).toBeInTheDocument();
  });

  it('requires selecting an option before Confirm is enabled', () => {
    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    expect(screen.getByRole('button', { name: /confirm date/i })).toBeDisabled();
  });

  it('submits confirm with the selected optionId and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'scheduled', bookingStatus: 'confirmed' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByLabelText(/july 15, 2099/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm date/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/portal/tok/booking/respond', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ decision: 'confirm', optionId: 'o1' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('reveals a required date picker on "Suggested date" and blocks submit until a date is chosen', async () => {
    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: /suggested date/i }));

    const dateInput = await screen.findByLabelText(/suggested date/i);
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();

    fireEvent.change(dateInput, { target: { value: '2099-08-01' } });
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();
  });

  it('submits reject with the chosen date formatted into the reason field, and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'approved', bookingStatus: 'rejected' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: /suggested date/i }));
    const dateInput = await screen.findByLabelText(/suggested date/i);
    fireEvent.change(dateInput, { target: { value: '2099-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ decision: 'reject', reason: 'Suggested: Saturday, August 1, 2099' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows an error banner on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByLabelText(/july 15, 2099/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm date/i }));

    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
  });
});

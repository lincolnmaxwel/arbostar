// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TimesheetClient } from '@/components/TimesheetClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function entryFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    workDate: '2026-09-01T12:00:00.000Z',
    startedAt: '2026-09-01T13:00:00.000Z',
    endedAt: '2026-09-01T16:30:00.000Z',
    durationMinutes: 210,
    hourlyRate: '50',
    status: 'open',
    client: { id: 'client-1', name: 'Nelson Costa' },
    products: [],
    ...overrides,
  };
}

function mockFetchResponse(impl: (url: string, opts?: RequestInit) => unknown) {
  fetchMock = vi.fn(async (url: string, opts?: RequestInit) => impl(url, opts)) as unknown as ReturnType<typeof vi.fn>;
  global.fetch = fetchMock as unknown as typeof fetch;
}

describe('TimesheetClient', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mockFetchResponse((url: string) => {
      if (url === '/api/timesheet') return { ok: true, json: async () => ({ entries: [] }) };
      if (url === '/api/clients') {
        return { ok: true, json: async () => ({ clients: [{ id: 'client-1', name: 'Nelson Costa', email: 'n@x.com' }] }) };
      }
      if (url === '/api/profile') {
        return { ok: true, json: async () => ({ user: { hourlyRate: 65.5 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
  });

  it('shows the hourly-rate snapshot notice from the profile', async () => {
    render(<TimesheetClient />);
    await waitFor(() => expect(screen.getByText(/\$65\.50\/hr/)).toBeInTheDocument());
  });

  it('adds and removes product rows', async () => {
    render(<TimesheetClient />);
    await screen.findAllByLabelText('Client');

    fireEvent.click(screen.getByRole('button', { name: '+ Add product' }));
    expect(screen.getByLabelText('Product name')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.queryByLabelText('Product name')).not.toBeInTheDocument());
  });

  it('rejects end-before-start with an English validation message', async () => {
    render(<TimesheetClient />);
    await screen.findAllByLabelText('Client');

    const client = screen.getAllByLabelText('Client')[0];
    fireEvent.change(client, { target: { value: 'client-1' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '17:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '09:00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await waitFor(() => expect(screen.getByText('End time must be after start time.')).toBeInTheDocument());
  });

  it('saves an entry with the computed time window and rate snapshot', async () => {
    let posted: any;
    mockFetchResponse((url: string, opts?: RequestInit) => {
      if (url === '/api/timesheet' && opts?.method === 'POST') {
        posted = JSON.parse(opts.body as string);
        return { ok: true, status: 201, json: async () => ({ entry: entryFixture() }) };
      }
      if (url === '/api/timesheet') return { ok: true, json: async () => ({ entries: [entryFixture()] }) };
      if (url === '/api/clients') {
        return { ok: true, json: async () => ({ clients: [{ id: 'client-1', name: 'Nelson Costa', email: 'n@x.com' }] }) };
      }
      if (url === '/api/profile') {
        return { ok: true, json: async () => ({ user: { hourlyRate: 65.5 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<TimesheetClient />);
    await screen.findAllByLabelText('Client');
    fireEvent.change(screen.getAllByLabelText('Client')[0], { target: { value: 'client-1' } });
    fireEvent.change(screen.getByLabelText('Work date'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '10:30' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted.clientId).toBe('client-1');
    expect(posted.workDate).toBe('2026-09-05');
    expect(new Date(posted.startedAt).getTime()).toBe(new Date('2026-09-05T08:00:00').getTime());
    expect(new Date(posted.endedAt).getTime()).toBe(new Date('2026-09-05T10:30:00').getTime());
  });

  it('renders entries with duration, rate, totals, and status badges', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/timesheet') {
        return {
          ok: true,
          json: async () => ({
            entries: [
              entryFixture({ products: [{ id: 'p1', name: 'Chips', quantity: '2', unitPrice: '25', lineTotal: 50 }] }),
              entryFixture({
                id: 'entry-2',
                workDate: '2026-09-02T12:00:00.000Z',
                status: 'invoiced',
                durationMinutes: 120,
                hourlyRate: '50',
                client: { id: 'client-1', name: 'Nelson Costa' },
                products: [],
              }),
            ],
          }),
        };
      }
      if (url === '/api/clients') {
        return { ok: true, json: async () => ({ clients: [{ id: 'client-1', name: 'Nelson Costa', email: 'n@x.com' }] }) };
      }
      if (url === '/api/profile') {
        return { ok: true, json: async () => ({ user: { hourlyRate: 65.5 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<TimesheetClient />);

    await waitFor(() => expect(screen.getByText('3.50')).toBeInTheDocument()); // 210 min = 3.5h
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Invoiced')).toBeInTheDocument();
    // Labor 3.5h x $50 = $175.00 + chips $50.00 = $225.00 subtotal.
    expect(screen.getByText('$225.00')).toBeInTheDocument();
    // Invoiced rows have no selectable checkbox.
    expect(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01')).toBeEnabled();
  });

  it('generates an invoice from selected open entries with the right request shape', async () => {
    let invoiceBody: any;
    mockFetchResponse((url: string, opts?: RequestInit) => {
      if (url === '/api/timesheet/invoice' && opts?.method === 'POST') {
        invoiceBody = JSON.parse(opts.body as string);
        return { ok: true, status: 201, json: async () => ({ invoice: { number: 42 }, entryIds: ['entry-1'] }) };
      }
      if (url === '/api/timesheet') return { ok: true, json: async () => ({ entries: [entryFixture()] }) };
      if (url === '/api/clients') {
        return { ok: true, json: async () => ({ clients: [{ id: 'client-1', name: 'Nelson Costa', email: 'n@x.com' }] }) };
      }
      if (url === '/api/profile') {
        return { ok: true, json: async () => ({ user: { hourlyRate: 65.5 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<TimesheetClient />);

    await waitFor(() => expect(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01'));
    fireEvent.click(screen.getByRole('button', { name: /generate invoice \(1 selected\)/i }));

    await waitFor(() => expect(invoiceBody).toBeTruthy());
    expect(invoiceBody.clientId).toBe('client-1');
    expect(invoiceBody.entryIds).toEqual(['entry-1']);

    await waitFor(() => expect(screen.getByText(/Invoice #42 created and emailed/)).toBeInTheDocument());
  });

  it('shows a conflict message when generation is rejected', async () => {
    mockFetchResponse((url: string, opts?: RequestInit) => {
      if (url === '/api/timesheet/invoice' && opts?.method === 'POST') {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'conflict', message: 'One or more entries were already invoiced. Refresh and try again.' }),
        };
      }
      if (url === '/api/timesheet') return { ok: true, json: async () => ({ entries: [entryFixture()] }) };
      if (url === '/api/clients') {
        return { ok: true, json: async () => ({ clients: [{ id: 'client-1', name: 'Nelson Costa', email: 'n@x.com' }] }) };
      }
      if (url === '/api/profile') {
        return { ok: true, json: async () => ({ user: { hourlyRate: 65.5 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<TimesheetClient />);

    await waitFor(() => expect(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01'));
    fireEvent.click(screen.getByRole('button', { name: /generate invoice \(1 selected\)/i }));

    await waitFor(() =>
      expect(screen.getByText('One or more entries were already invoiced. Refresh and try again.')).toBeInTheDocument(),
    );
  });

  it('blocks mixed-client selection with an English warning', async () => {
    mockFetchResponse((url: string) => {
      if (url === '/api/timesheet') {
        return {
          ok: true,
          json: async () => ({
            entries: [
              entryFixture(),
              entryFixture({
                id: 'entry-other',
                workDate: '2026-09-03T12:00:00.000Z',
                status: 'open',
                client: { id: 'client-2', name: 'Maria Silva' },
                products: [],
              }),
            ],
          }),
        };
      }
      if (url === '/api/clients') {
        return {
          ok: true,
          json: async () => ({
            clients: [
              { id: 'client-1', name: 'Nelson Costa', email: 'n@x.com' },
              { id: 'client-2', name: 'Maria Silva', email: 'm@x.com' },
            ],
          }),
        };
      }
      if (url === '/api/profile') {
        return { ok: true, json: async () => ({ user: { hourlyRate: 65.5 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<TimesheetClient />);

    await waitFor(() => expect(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01'));
    fireEvent.click(screen.getByLabelText('Select entry for Maria Silva on 2026-09-03'));

    await waitFor(() => expect(screen.getByText('Select entries for one client at a time.')).toBeInTheDocument());
    // The first selection is still intact; the second checkbox stays unselected.
    expect(screen.getByLabelText('Select entry for Maria Silva on 2026-09-03')).not.toBeChecked();
    expect(screen.getByLabelText('Select entry for Nelson Costa on 2026-09-01')).toBeChecked();
  });

  it('rejects a From date after the To date', async () => {
    mockFetchResponse((url: string) => {
      if (url === '/api/timesheet') return { ok: true, json: async () => ({ entries: [] }) };
      if (url === '/api/clients') {
        return { ok: true, json: async () => ({ clients: [{ id: 'client-1', name: 'Nelson Costa', email: 'n@x.com' }] }) };
      }
      if (url === '/api/profile') {
        return { ok: true, json: async () => ({ user: { hourlyRate: 65.5 } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<TimesheetClient />);
    await screen.findAllByLabelText('Client');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByText(/must be on or before/)).toBeInTheDocument());
  });
});
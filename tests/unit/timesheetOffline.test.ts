import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import {
  queueClient,
  syncPendingClients,
  queueTimesheetEntry,
  syncPendingTimesheet,
  retryPendingTimesheet,
  discardPendingTimesheet,
} from '@/lib/timesheetOffline';

const OWNER = 'owner-a';
const OTHER = 'owner-b';

function entry(owner = OWNER, overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: owner,
    clientId: 'client-1',
    clientName: 'Nelson Costa',
    workDate: '2026-10-15',
    startedAt: '2026-10-15T13:00:00.000Z',
    endedAt: '2026-10-15T16:00:00.000Z',
    description: 'Pruning',
    products: [{ name: 'Mulch', quantity: 2, unitPrice: 10 }],
    ...overrides,
  };
}

function respond(status: number, body: unknown = {}) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

describe('timesheetOffline', () => {
  beforeEach(async () => {
    await localDb.timesheetPending.clear();
    await localDb.clientsPending.clear();
    vi.restoreAllMocks();
  });

  it('sends a pending entry with its idempotency key and removes the local copy', async () => {
    const id = await queueTimesheetEntry(entry());
    const fetchMock = respond(201, { entry: { id: 'srv-1' } });
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await syncPendingTimesheet(OWNER)).toBe(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/timesheet');
    const sent = JSON.parse(init.body as string);
    expect(sent.clientEntryId).toBe(id);
    expect(sent.clientId).toBe('client-1');
    expect(sent.products).toEqual([{ name: 'Mulch', quantity: 2, unitPrice: 10 }]);
    expect(await localDb.timesheetPending.count()).toBe(0);
  });

  it('keeps the entry and backs off on a network error or a 5xx', async () => {
    const id = await queueTimesheetEntry(entry());
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await syncPendingTimesheet(OWNER)).toBe(0);
    let row = await localDb.timesheetPending.get(id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row!.nextAttemptAt).toBeGreaterThan(Date.now());

    // not due yet -> not retried
    const fetchMock = respond(201);
    global.fetch = fetchMock as unknown as typeof fetch;
    await syncPendingTimesheet(OWNER);
    expect(fetchMock).not.toHaveBeenCalled();

    await localDb.timesheetPending.update(id, { nextAttemptAt: Date.now() - 1 });
    global.fetch = respond(503) as unknown as typeof fetch;
    await syncPendingTimesheet(OWNER);
    row = await localDb.timesheetPending.get(id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(2);
  });

  it('marks the entry as failed when the server rejects it, and lets the user retry', async () => {
    const id = await queueTimesheetEntry(entry());
    global.fetch = respond(404, { error: 'Client not found.' }) as unknown as typeof fetch;
    await syncPendingTimesheet(OWNER);
    const row = await localDb.timesheetPending.get(id);
    expect(row?.status).toBe('error');
    expect(row?.lastError).toBe('Client not found.');

    const fetchMock = respond(201);
    global.fetch = fetchMock as unknown as typeof fetch;
    await syncPendingTimesheet(OWNER);
    expect(fetchMock).not.toHaveBeenCalled(); // failed entries are not retried automatically

    await retryPendingTimesheet(id);
    expect(await syncPendingTimesheet(OWNER)).toBe(1);
  });

  it('keeps the entry untouched (no failure count) when the session has expired', async () => {
    const id = await queueTimesheetEntry(entry());
    global.fetch = respond(401) as unknown as typeof fetch;
    await syncPendingTimesheet(OWNER);
    const row = await localDb.timesheetPending.get(id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
  });

  it('creates an offline client first, then sends the entries that use it', async () => {
    const clientId = await queueClient({ ownerUserId: OWNER, name: 'New Co', email: 'n@c.com', phone: '', address: '' });
    await queueTimesheetEntry(entry(OWNER, { clientId, clientName: 'New Co' }));

    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      const body = JSON.parse(init!.body as string);
      if (url === '/api/clients') return { ok: true, status: 201, json: async () => ({ client: { id: body.id, name: body.name } }) };
      return { ok: true, status: 201, json: async () => ({ entry: { id: 'e1' } }) };
    }) as unknown as typeof fetch;

    await syncPendingTimesheet(OWNER);
    expect(calls).toEqual(['/api/clients', '/api/timesheet']);
    expect(await localDb.clientsPending.count()).toBe(0);
    expect(await localDb.timesheetPending.count()).toBe(0);
  });

  it('re-points entries to the existing client when the server merges by email', async () => {
    const clientId = await queueClient({ ownerUserId: OWNER, name: 'Dup', email: 'd@c.com', phone: '', address: '' });
    const id = await queueTimesheetEntry(entry(OWNER, { clientId, clientName: 'Dup' }));
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ client: { id: 'existing-client', name: 'Dup Existing' }, merged: true }),
    })) as unknown as typeof fetch;

    await syncPendingClients(OWNER);
    const row = await localDb.timesheetPending.get(id);
    expect(row?.clientId).toBe('existing-client');
    expect(row?.clientName).toBe('Dup Existing');
  });

  it('holds entries while their client is not created yet, and fails them if the client is rejected', async () => {
    const clientId = await queueClient({ ownerUserId: OWNER, name: 'Bad', email: '', phone: '', address: '' });
    const id = await queueTimesheetEntry(entry(OWNER, { clientId, clientName: 'Bad' }));

    // network down: nothing is sent for the entry
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await syncPendingTimesheet(OWNER);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['/api/clients']);
    expect((await localDb.timesheetPending.get(id))?.status).toBe('pending');

    // server rejects the client for good
    await localDb.clientsPending.update(clientId, { nextAttemptAt: Date.now() - 1 });
    global.fetch = respond(400, { message: 'Invalid client.' }) as unknown as typeof fetch;
    await syncPendingTimesheet(OWNER);
    const row = await localDb.timesheetPending.get(id);
    expect(row?.status).toBe('error');
    expect(row?.lastError).toContain('Bad');
    expect(row?.lastError).toContain('Invalid client.');
  });

  it('only syncs the given owner and can discard an entry', async () => {
    const mine = await queueTimesheetEntry(entry(OWNER));
    await queueTimesheetEntry(entry(OTHER));
    const fetchMock = respond(201);
    global.fetch = fetchMock as unknown as typeof fetch;

    await syncPendingTimesheet(OWNER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await localDb.timesheetPending.where('ownerUserId').equals(OTHER).count()).toBe(1);

    await discardPendingTimesheet(mine);
    expect(await localDb.timesheetPending.get(mine)).toBeUndefined();
  });
});

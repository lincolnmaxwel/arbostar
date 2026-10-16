import { localDb, PendingClient, PendingTimesheetEntry } from '@/lib/localDb';

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 5 * 60 * 1000;

/** Dispatched on `window` whenever pending entries reach the server. */
export const TIMESHEET_SYNCED_EVENT = 'myjobbs:timesheet-synced';

export type NewPendingTimesheetEntry = Omit<
  PendingTimesheetEntry,
  'localId' | 'status' | 'attempts' | 'nextAttemptAt' | 'createdAt' | 'lastError'
>;

// A real RFC 4122 v4 UUID: client ids created offline are sent to the server
// as the client's actual id, which it only accepts in this format.
function newLocalId(): string {
  const webCrypto: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type NewPendingClient = Pick<PendingClient, 'ownerUserId' | 'name' | 'email' | 'phone' | 'address'>;

/** Stores a client created offline. Its id is usable right away (e.g. by pending entries). */
export async function queueClient(client: NewPendingClient, id: string = newLocalId()): Promise<string> {
  await localDb.clientsPending.put({
    ...client,
    id,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  return id;
}

export function newClientId(): string {
  return newLocalId();
}

/** Stores an entry on this device to be sent later. Returns its idempotency key. */
export async function queueTimesheetEntry(
  entry: NewPendingTimesheetEntry,
  localId: string = newLocalId(),
): Promise<string> {
  await localDb.timesheetPending.put({
    ...entry,
    localId,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  return localId;
}

export function newTimesheetEntryId(): string {
  return newLocalId();
}

export async function discardPendingTimesheet(localId: string): Promise<void> {
  await localDb.timesheetPending.delete(localId);
}

/** Put a failed entry back in line (after the user fixed the cause) and try now. */
export async function retryPendingTimesheet(localId: string): Promise<void> {
  const entry = await localDb.timesheetPending.get(localId);
  await localDb.timesheetPending.update(localId, { status: 'pending', attempts: 0, nextAttemptAt: Date.now() });
  // If it failed because its brand-new client could not be created, retry that too.
  if (entry) {
    const client = await localDb.clientsPending.get(entry.clientId);
    if (client?.status === 'error') {
      await localDb.clientsPending.update(client.id, { status: 'pending', attempts: 0, nextAttemptAt: Date.now() });
    }
  }
}

function backoff(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
}

function toRequestBody(entry: PendingTimesheetEntry) {
  return {
    clientEntryId: entry.localId,
    clientId: entry.clientId,
    workDate: entry.workDate,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    description: entry.description,
    products: entry.products,
  };
}

function errorMessage(body: unknown, status: number): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    const first = fieldErrors && Object.values(fieldErrors).flat()[0];
    if (first) return first;
  }
  return `The server rejected this entry (HTTP ${status}).`;
}

/**
 * Creates the clients that were added offline. The server takes the id the
 * device already used, so pending entries need no remapping; the one exception
 * is a client whose email matches an existing client of the user: the server
 * answers with that one and the entries are re-pointed to it.
 */
export async function syncPendingClients(ownerUserId: string): Promise<number> {
  const now = Date.now();
  const due = await localDb.clientsPending
    .where('ownerUserId')
    .equals(ownerUserId)
    .filter((client) => client.status === 'pending' && client.nextAttemptAt <= now)
    .sortBy('createdAt');

  let sent = 0;
  for (const client of due) {
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          address: client.address,
        }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const realId = (body?.client as { id?: string; name?: string } | undefined)?.id;
        if (realId && realId !== client.id) {
          const name = (body.client as { name?: string }).name ?? client.name;
          await localDb.timesheetPending
            .filter((entry) => entry.clientId === client.id)
            .modify({ clientId: realId, clientName: name });
        }
        await localDb.clientsPending.delete(client.id);
        sent += 1;
      } else if (res.status === 401) {
        await localDb.clientsPending.update(client.id, { nextAttemptAt: Date.now() + 30_000 });
      } else if (res.status >= 400 && res.status < 500) {
        const body = await res.json().catch(() => null);
        const message =
          typeof body?.message === 'string' ? body.message : errorMessage(body, res.status);
        await localDb.clientsPending.update(client.id, { status: 'error', lastError: message });
        // Entries waiting on this client can never be sent as they are.
        await localDb.timesheetPending
          .filter((entry) => entry.clientId === client.id)
          .modify({ status: 'error', lastError: `The new client "${client.name}" could not be saved: ${message}` });
      } else {
        const attempts = client.attempts + 1;
        await localDb.clientsPending.update(client.id, {
          attempts,
          lastError: `Server error ${res.status}`,
          nextAttemptAt: Date.now() + backoff(attempts),
        });
      }
    } catch (err) {
      const attempts = client.attempts + 1;
      await localDb.clientsPending.update(client.id, {
        attempts,
        lastError: (err as Error).message,
        nextAttemptAt: Date.now() + backoff(attempts),
      });
    }
  }
  return sent;
}

/**
 * Sends every due pending entry of this owner (after the clients they need). Safe to call repeatedly and
 * from several places at once: the server answers a repeated key with the
 * entry it already created.
 *   - 200/201          -> sent, local copy removed
 *   - 401              -> session expired: keep it, try again soon (no failure count)
 *   - other 4xx        -> the server will never accept it as is: mark 'error'
 *   - 5xx / no network -> keep it, retry with backoff
 * Returns how many entries were sent.
 */
export async function syncPendingTimesheet(ownerUserId: string): Promise<number> {
  const clientsSent = await syncPendingClients(ownerUserId);
  // Entries for a client that is still only on this device must wait for it.
  const unsyncedClientIds = new Set((await localDb.clientsPending.toArray()).map((client) => client.id));

  const now = Date.now();
  const due = await localDb.timesheetPending
    .where('ownerUserId')
    .equals(ownerUserId)
    .filter((entry) => entry.status === 'pending' && entry.nextAttemptAt <= now && !unsyncedClientIds.has(entry.clientId))
    .sortBy('createdAt');

  let sent = 0;
  for (const entry of due) {
    try {
      const res = await fetch('/api/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toRequestBody(entry)),
      });
      if (res.ok) {
        await localDb.timesheetPending.delete(entry.localId);
        sent += 1;
      } else if (res.status === 401) {
        await localDb.timesheetPending.update(entry.localId, { nextAttemptAt: Date.now() + 30_000 });
      } else if (res.status >= 400 && res.status < 500) {
        const body = await res.json().catch(() => null);
        await localDb.timesheetPending.update(entry.localId, {
          status: 'error',
          lastError: errorMessage(body, res.status),
        });
      } else {
        const attempts = entry.attempts + 1;
        await localDb.timesheetPending.update(entry.localId, {
          attempts,
          lastError: `Server error ${res.status}`,
          nextAttemptAt: Date.now() + backoff(attempts),
        });
      }
    } catch (err) {
      const attempts = entry.attempts + 1;
      await localDb.timesheetPending.update(entry.localId, {
        attempts,
        lastError: (err as Error).message,
        nextAttemptAt: Date.now() + backoff(attempts),
      });
    }
  }

  if (sent + clientsSent > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TIMESHEET_SYNCED_EVENT));
  }
  return sent;
}

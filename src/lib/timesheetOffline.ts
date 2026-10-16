import { localDb, PendingTimesheetEntry } from '@/lib/localDb';

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 5 * 60 * 1000;

/** Dispatched on `window` whenever pending entries reach the server. */
export const TIMESHEET_SYNCED_EVENT = 'myjobbs:timesheet-synced';

export type NewPendingTimesheetEntry = Omit<
  PendingTimesheetEntry,
  'localId' | 'status' | 'attempts' | 'nextAttemptAt' | 'createdAt' | 'lastError'
>;

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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
  await localDb.timesheetPending.update(localId, { status: 'pending', attempts: 0, nextAttemptAt: Date.now() });
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
 * Sends every due pending entry of this owner. Safe to call repeatedly and
 * from several places at once: the server answers a repeated key with the
 * entry it already created.
 *   - 200/201          -> sent, local copy removed
 *   - 401              -> session expired: keep it, try again soon (no failure count)
 *   - other 4xx        -> the server will never accept it as is: mark 'error'
 *   - 5xx / no network -> keep it, retry with backoff
 * Returns how many entries were sent.
 */
export async function syncPendingTimesheet(ownerUserId: string): Promise<number> {
  const now = Date.now();
  const due = await localDb.timesheetPending
    .where('ownerUserId')
    .equals(ownerUserId)
    .filter((entry) => entry.status === 'pending' && entry.nextAttemptAt <= now)
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

  if (sent > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TIMESHEET_SYNCED_EVENT));
  }
  return sent;
}

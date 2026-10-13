import { localDb } from '@/lib/localDb';
import type { BillingInfo } from '@/lib/billing';

export interface ViewContext {
  actorUserId: string;
  actorRole: string | null;
  ownerUserId: string;
  isViewAs: boolean;
  targetName: string | null;
  features: {
    quotes: boolean;
    invoices: boolean;
    timesheet: boolean;
    clients_crm: boolean;
  };
  /** Subscription/trial state of the effective owner (null if unavailable). */
  billing: BillingInfo | null;
}

let cachedContext: ViewContext | null = null;
let pendingFetch: Promise<ViewContext | null> | null = null;
// After a 401 (signed out / public page) do not ask again for a while: the
// background sync loop polls this every few seconds and would otherwise fill
// the console with 401s for every visitor who is not signed in.
const UNAUTHORIZED_BACKOFF_MS = 60_000;
let unauthorizedUntil = 0;

/**
 * Client-side source of the effective user context (see GET
 * /api/view-context). Fetched once per session and cached; the first
 * authenticated load claims any legacy (owner-less) local rows for the
 * current effective owner exactly once — rows already claimed are never
 * reassigned to a different user later.
 */
export async function getViewContext(): Promise<ViewContext | null> {
  if (cachedContext) return cachedContext;
  if (Date.now() < unauthorizedUntil) return null;
  if (!pendingFetch) {
    pendingFetch = fetch('/api/view-context', { cache: 'no-store' })
      .then((res) => {
        if (res.status === 401) unauthorizedUntil = Date.now() + UNAUTHORIZED_BACKOFF_MS;
        return res.ok ? res.json() : null;
      })
      .then(async (body) => {
        if (!body) return null;
        cachedContext = body as ViewContext;
        await claimLegacyRows(cachedContext.ownerUserId);
        return cachedContext;
      })
      .finally(() => {
        pendingFetch = null;
      });
  }
  return pendingFetch;
}

/** Drop the cached context so the next call refetches (view-as switches). */
export function resetViewContext(): void {
  cachedContext = null;
  unauthorizedUntil = 0;
}

async function claimLegacyRows(ownerUserId: string): Promise<void> {
  await localDb.transaction(
    'rw',
    [localDb.drafts, localDb.outbox, localDb.pendingDeletes],
    async () => {
      const legacyDrafts = await localDb.drafts.filter((d) => !d.ownerUserId).toArray();
      for (const d of legacyDrafts) {
        await localDb.drafts.update(d.draftId, { ownerUserId });
      }
      const legacyOutbox = await localDb.outbox.filter((e) => !e.ownerUserId).toArray();
      for (const e of legacyOutbox) {
        await localDb.outbox.update(e.id!, { ownerUserId });
      }
      const legacyDeletes = await localDb.pendingDeletes.filter((p) => !p.ownerUserId).toArray();
      for (const p of legacyDeletes) {
        await localDb.pendingDeletes.update(p.serverId, { ownerUserId });
      }
    },
  );
}
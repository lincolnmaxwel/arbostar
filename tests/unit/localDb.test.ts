import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { localDb } from '@/lib/localDb';
import { getViewContext, resetViewContext } from '@/lib/clientUserContext';

function mockViewContextFetch(ownerUserId: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      actorUserId: ownerUserId,
      actorRole: 'staff',
      ownerUserId,
      isViewAs: false,
      targetName: null,
      features: { quotes: true, invoices: true, timesheet: true, clients_crm: true },
    }),
  }) as unknown as typeof fetch;
}

describe('localDb drafts table', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
    await localDb.pendingDeletes.clear();
    resetViewContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes and reads back a draft', async () => {
    await localDb.drafts.put({
      draftId: 'draft-1',
      ownerUserId: 'user-a',
      clientName: 'Nelson Costa',
      clientEmail: 'nelson@example.com',
      items: [],
      taxRate: 0.05,
      status: 'local',
      updatedAt: Date.now(),
    });
    const saved = await localDb.drafts.get('draft-1');
    expect(saved?.clientName).toBe('Nelson Costa');
    expect(saved?.status).toBe('local');
    expect(saved?.ownerUserId).toBe('user-a');
  });

  it('claims legacy owner-less rows for the current owner exactly once on first authenticated load', async () => {
    // Legacy rows created before ownerUserId existed — no owner at all.
    await localDb.drafts.put({
      draftId: 'legacy-draft',
      clientName: 'Legacy Client',
      clientEmail: 'legacy@example.com',
      items: [],
      taxRate: 0.05,
      status: 'local',
      updatedAt: Date.now(),
    } as never);
    await localDb.outbox.add({
      draftId: 'legacy-draft',
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
    } as never);
    await localDb.pendingDeletes.put({
      serverId: 'legacy-server',
      draftId: 'legacy-draft',
      createdAt: Date.now(),
    } as never);

    global.fetch = mockViewContextFetch('user-b');
    const ctx = await getViewContext();
    expect(ctx?.ownerUserId).toBe('user-b');

    expect((await localDb.drafts.get('legacy-draft'))?.ownerUserId).toBe('user-b');
    const outboxRows = await localDb.outbox.toArray();
    expect(outboxRows[0].ownerUserId).toBe('user-b');
    const pendingRows = await localDb.pendingDeletes.toArray();
    expect(pendingRows[0].ownerUserId).toBe('user-b');

    // A second user loading the app must NOT re-claim the same row.
    resetViewContext();
    global.fetch = mockViewContextFetch('user-c');
    await getViewContext();
    expect((await localDb.drafts.get('legacy-draft'))?.ownerUserId).toBe('user-b');
  });
});
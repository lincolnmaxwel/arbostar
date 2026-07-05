import { describe, it, expect, beforeEach } from 'vitest';
import { localDb } from '@/lib/localDb';

describe('localDb drafts table', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
  });

  it('writes and reads back a draft', async () => {
    await localDb.drafts.put({
      draftId: 'draft-1',
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
  });
});

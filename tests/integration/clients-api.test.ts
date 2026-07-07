import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/clients/route';
import { prisma } from '@/lib/db';

describe('GET /api/clients', () => {
  let userId: string;
  let scheduledClientId: string;
  let completedClientId: string;
  let draftOnlyClientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Clients Test', email: `clientsapi-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });

    const scheduledClient = await prisma.client.create({ data: { name: 'Scheduled Client', email: `sched-${randomUUID()}@example.com` } });
    scheduledClientId = scheduledClient.id;
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: scheduledClient.id, createdById: userId, status: 'scheduled' },
    });

    const completedClient = await prisma.client.create({ data: { name: 'Completed Client', email: `comp-${randomUUID()}@example.com` } });
    completedClientId = completedClient.id;
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: completedClient.id, createdById: userId, status: 'completed' },
    });

    const draftOnlyClient = await prisma.client.create({ data: { name: 'Draft Only Client', email: `draft-${randomUUID()}@example.com` } });
    draftOnlyClientId = draftOnlyClient.id;
    await prisma.quote.create({
      data: { draftId: randomUUID(), clientId: draftOnlyClient.id, createdById: userId, status: 'sent' },
    });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { id: { in: [scheduledClientId, completedClientId, draftOnlyClientId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('includes clients with a scheduled or completed quote', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.clients.map((c: { name: string }) => c.name);
    expect(names).toContain('Scheduled Client');
    expect(names).toContain('Completed Client');
  });

  it('excludes a client whose quotes never got past draft/sent/approved', async () => {
    const res = await GET();
    const body = await res.json();
    const names = body.clients.map((c: { name: string }) => c.name);
    expect(names).not.toContain('Draft Only Client');
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

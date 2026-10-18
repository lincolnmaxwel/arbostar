import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { nextInvoiceNumber } from '@/lib/invoiceNumber';

const userIds: string[] = [];

async function makeUser(tag: string) {
  const user = await prisma.user.create({
    data: { name: tag, email: `${tag}-${Date.now()}@example.com`, passwordHash: 'x', role: 'staff' },
  });
  userIds.push(user.id);
  const client = await prisma.client.create({ data: { userId: user.id, name: 'C', email: `c-${tag}-${Date.now()}@example.com` } });
  return { user, client };
}

async function issue(userId: string, clientId: string) {
  return prisma.$transaction(async (tx) =>
    tx.invoice.create({
      data: { number: await nextInvoiceNumber(tx, userId), source: 'timesheet', userId, clientId, subtotal: 1, taxRate: 0, taxAmount: 0, total: 1 },
    }),
  );
}

describe('per-user invoice numbers', () => {
  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.client.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it('starts every account at 1 and counts independently', async () => {
    const a = await makeUser('inv-a');
    const b = await makeUser('inv-b');
    expect((await issue(a.user.id, a.client.id)).number).toBe(1);
    expect((await issue(a.user.id, a.client.id)).number).toBe(2);
    expect((await issue(b.user.id, b.client.id)).number).toBe(1);
  });

  it('never hands the same number to concurrent requests of one user', async () => {
    const { user, client } = await makeUser('inv-c');
    const made = await Promise.all([1, 2, 3, 4].map(() => issue(user.id, client.id)));
    expect(new Set(made.map((i) => i.number)).size).toBe(4);
  });
});

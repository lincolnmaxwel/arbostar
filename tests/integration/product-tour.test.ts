import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'arbostar-view-as-user' && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { POST as tour } from '@/app/api/profile/tour/route';
import { GET as viewContext } from '@/app/api/view-context/route';
import { PATCH as patchProfile } from '@/app/api/profile/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

function tourReq(body: unknown) {
  return tour(new Request('http://localhost/api/profile/tour', { method: 'POST', body: JSON.stringify(body) }));
}
async function pending(): Promise<boolean> {
  return (await (await viewContext()).json()).tourPending;
}

describe('first-login product tour', () => {
  let staffId: string;
  let adminId: string;

  beforeAll(async () => {
    const mk = (role: 'staff' | 'admin') =>
      prisma.user.create({ data: { name: role, email: `${role}-${randomUUID()}@example.com`, passwordHash: 'x', role } });
    staffId = (await mk('staff')).id;
    adminId = (await mk('admin')).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [staffId, adminId] } } });
  });
  beforeEach(() => {
    cookieValue.current = undefined;
    sessionMock.mockReset();
  });

  it('is pending for a new account, done after finishing, pending again on replay request', async () => {
    sessionMock.mockResolvedValue({ user: { id: staffId } });
    expect(await pending()).toBe(true);
    expect((await tourReq({ done: true })).status).toBe(200);
    expect(await pending()).toBe(false);
    expect((await tourReq({ done: false })).status).toBe(200);
    expect(await pending()).toBe(true);
  });

  it('never auto-starts for an admin', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    expect(await pending()).toBe(false);
  });

  it('does not start for an admin viewing as a new account', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieValue.current = staffId;
    expect(await pending()).toBe(false);
  });

  it('rejects signed-out and malformed requests', async () => {
    sessionMock.mockResolvedValue(null);
    expect((await tourReq({ done: true })).status).toBe(401);
    sessionMock.mockResolvedValue({ user: { id: staffId } });
    expect((await tourReq({ done: 'yes' })).status).toBe(400);
  });

  it('saving the hourly rate keeps the notification email', async () => {
    sessionMock.mockResolvedValue({ user: { id: staffId } });
    const patch = (body: unknown) => patchProfile(new Request('http://localhost/api/profile', { method: 'PATCH', body: JSON.stringify(body) }) as never);
    expect((await patch({ notificationEmail: 'notify@example.com' })).status).toBe(200);
    expect((await patch({ hourlyRate: 55 })).status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(u.notificationEmail).toBe('notify@example.com');
    expect(Number(u.hourlyRate)).toBe(55);
    await patch({ notificationEmail: '' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).notificationEmail).toBeNull();
  });
});

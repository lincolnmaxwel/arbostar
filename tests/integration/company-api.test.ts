import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, readdirSync, rmSync } from 'fs';
import path from 'path';

const { cookieGetMock } = vi.hoisted(() => ({ cookieGetMock: vi.fn() }));

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('next/headers', () => ({
  cookies: () => ({ get: cookieGetMock }),
}));

import { getServerSession } from 'next-auth';
import { GET, PATCH } from '@/app/api/company/route';
import { POST as uploadLogo, DELETE as removeLogo } from '@/app/api/company/logo/route';
import { GET as serveLogo } from '@/app/api/uploads/company/[filename]/route';
import { prisma } from '@/lib/db';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

function patchReq(body: unknown) {
  return new Request('http://localhost/api/company', { method: 'PATCH', body: JSON.stringify(body) }) as any;
}

const uploadsDir = path.join(process.cwd(), 'uploads', 'company');
const uploadedByTest = new Set<string>();

describe('/api/company (per-user billing profile)', () => {
  let userId: string;
  let otherUserId: string;
  let adminId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Company Test', email: `company-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    const other = await prisma.user.create({
      data: { name: 'Other User', email: `company-other-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    otherUserId = other.id;
    const admin = await prisma.user.create({
      data: { name: 'Company Admin', email: `company-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.companyProfile.deleteMany({
      where: { userId: { in: [userId, otherUserId, adminId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId, adminId] } } });
    for (const file of uploadedByTest) {
      rmSync(path.join(uploadsDir, file), { force: true });
    }
  });

  beforeEach(() => {
    sessionMock.mockReset();
    cookieGetMock.mockReset();
  });

  function asUser(id: string) {
    sessionMock.mockResolvedValue({ user: { id } });
    cookieGetMock.mockReturnValue(undefined);
  }

  it('GET creates and returns an empty profile owned by the user', async () => {
    asUser(userId);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.company.name).toBeNull();
    expect(body.company.logoUrl).toBeNull();
    const profile = await prisma.companyProfile.findUnique({ where: { userId } });
    expect(profile?.userId).toBe(userId);
  });

  it('GET returns 401 when unauthenticated', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('PATCH updates name/phone/email/address for the user\'s own profile', async () => {
    asUser(userId);
    const res = await PATCH(
      patchReq({ name: 'Test Co', phone: '(555) 000-1111', email: 'test@example.com', address: '1 Test St' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.company.name).toBe('Test Co');
    expect(body.company.address).toBe('1 Test St');
  });

  it('PATCH rejects an invalid email', async () => {
    asUser(userId);
    const res = await PATCH(patchReq({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('profiles are isolated per user', async () => {
    asUser(userId);
    await PATCH(patchReq({ name: 'User A Co', phone: '111' }));
    asUser(otherUserId);
    const res = await GET();
    const body = await res.json();
    expect(body.company.name).toBeNull();
  });

  it('uploads a logo, stores it outside public/, and serves it through the uploads route', async () => {
    asUser(userId);
    const form = new FormData();
    form.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'logo.jpg');
    const uploadRes = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form }) as any);
    expect(uploadRes.status).toBe(200);
    const body = await uploadRes.json();
    expect(body.company.logoUrl).toMatch(/^\/api\/uploads\/company\//);

    const fileName = body.company.logoUrl.split('/').pop();
    uploadedByTest.add(fileName);
    const filePath = path.join(uploadsDir, fileName);
    expect(existsSync(filePath)).toBe(true);

    const serveRes = await serveLogo(new Request('http://localhost/api/uploads/company/' + fileName) as any, { params: { filename: fileName } });
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('rejects a non-image file', async () => {
    asUser(userId);
    const form = new FormData();
    form.set('file', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'file.txt');
    const res = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form }) as any);
    expect(res.status).toBe(400);
  });

  it('replacing the logo deletes the previous file', async () => {
    asUser(userId);
    const form1 = new FormData();
    form1.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'logo1.jpg');
    const res1 = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form1 }) as any);
    const body1 = await res1.json();
    const fileName1 = body1.company.logoUrl.split('/').pop();
    uploadedByTest.add(fileName1);
    const filePath1 = path.join(uploadsDir, fileName1);
    expect(existsSync(filePath1)).toBe(true);

    const form2 = new FormData();
    form2.set('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'logo2.png');
    const res2 = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form2 }) as any);
    const body2 = await res2.json();
    const fileName2 = body2.company.logoUrl.split('/').pop();
    uploadedByTest.add(fileName2);

    expect(existsSync(filePath1)).toBe(false);
  });

  it('removeLogo clears the logoPath and deletes the file', async () => {
    asUser(userId);
    const form = new FormData();
    form.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'logo-remove.jpg');
    const uploadRes = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form }) as any);
    const body = await uploadRes.json();
    const fileName = body.company.logoUrl.split('/').pop();
    uploadedByTest.add(fileName);

    const res = await removeLogo();
    expect(res.status).toBe(200);
    const removed = await res.json();
    expect(removed.company.logoPath).toBeNull();
    expect(existsSync(path.join(uploadsDir, fileName))).toBe(false);
  });

  it('a view-as admin edits the target\'s profile and writes an audit row with the real actor', async () => {
    asUser(adminId);
    cookieGetMock.mockReturnValue({ value: userId });
    const res = await PATCH(patchReq({ name: 'Edited By Admin' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.company.name).toBe('Edited By Admin');

    const profile = await prisma.companyProfile.findUniqueOrThrow({ where: { userId } });
    expect(profile.name).toBe('Edited By Admin');

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, targetUserId: userId, entityType: 'CompanyProfile', action: 'update' },
    });
    expect(audit).not.toBeNull();
  });
});
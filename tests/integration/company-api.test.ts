import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import path from 'path';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET, PATCH } from '@/app/api/company/route';
import { POST as uploadLogo } from '@/app/api/company/logo/route';
import { GET as serveLogo } from '@/app/api/uploads/company/[filename]/route';
import { prisma } from '@/lib/db';
import { COMPANY_PROFILE_ID } from '@/lib/companyProfile';

function patchReq(body: unknown) {
  return new Request('http://localhost/api/company', { method: 'PATCH', body: JSON.stringify(body) }) as any;
}

describe('/api/company', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Company Test', email: `company-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.companyProfile.deleteMany({ where: { id: COMPANY_PROFILE_ID } });
    const dir = path.join(process.cwd(), 'uploads', 'company');
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.companyProfile.deleteMany({ where: { id: COMPANY_PROFILE_ID } });
  });

  it('GET creates the singleton row on first access and returns null fields', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.company.name).toBeNull();
    expect(body.company.logoUrl).toBeNull();

    const rows = await prisma.companyProfile.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(COMPANY_PROFILE_ID);
  });

  it('GET returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('PATCH updates name/phone/email/address', async () => {
    const res = await PATCH(
      patchReq({ name: 'Tip Top Tree Service Ltd', phone: '(250) 857-2420', email: 'info@tiptoptreesltd.com', address: '4115 Holland Ave, Victoria, BC' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.company.name).toBe('Tip Top Tree Service Ltd');
    expect(body.company.address).toBe('4115 Holland Ave, Victoria, BC');
  });

  it('PATCH rejects an invalid email', async () => {
    const res = await PATCH(patchReq({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('uploads a logo, stores it outside public/, and serves it through the uploads route', async () => {
    const form = new FormData();
    form.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'logo.jpg');
    const uploadRes = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form }) as any);
    expect(uploadRes.status).toBe(200);
    const body = await uploadRes.json();
    expect(body.company.logoUrl).toMatch(/^\/api\/uploads\/company\//);

    const fileName = body.company.logoUrl.split('/').pop();
    const filePath = path.join(process.cwd(), 'uploads', 'company', fileName);
    expect(existsSync(filePath)).toBe(true);

    const serveRes = await serveLogo(new Request('http://localhost/api/uploads/company/' + fileName) as any, { params: { filename: fileName } });
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('rejects a non-image file', async () => {
    const form = new FormData();
    form.set('file', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'file.txt');
    const res = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form }) as any);
    expect(res.status).toBe(400);
  });

  it('replacing the logo deletes the previous file', async () => {
    const form1 = new FormData();
    form1.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'logo1.jpg');
    const res1 = await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form1 }) as any);
    const body1 = await res1.json();
    const fileName1 = body1.company.logoUrl.split('/').pop();
    const filePath1 = path.join(process.cwd(), 'uploads', 'company', fileName1);
    expect(existsSync(filePath1)).toBe(true);

    const form2 = new FormData();
    form2.set('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'logo2.png');
    await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form2 }) as any);

    expect(existsSync(filePath1)).toBe(false);
  });
});

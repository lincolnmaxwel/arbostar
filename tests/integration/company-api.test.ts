import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, readdirSync, rmSync } from 'fs';
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

const uploadsDir = path.join(process.cwd(), 'uploads', 'company');

describe('/api/company', () => {
  let userId: string;
  // CompanyProfile is a real singleton (fixed id, the SAME row a real
  // deployment's /profile page edits) and the logo lives in the SAME
  // uploads/company/ directory a real logo would — snapshot both so every
  // test can freely upsert/delete without a `deleteMany`/`rmSync` on the row
  // or directory ever touching real data, and restore the snapshot in
  // afterAll regardless of what the tests did in between.
  let originalCompany: Awaited<ReturnType<typeof prisma.companyProfile.findUnique>>;
  let originalFiles: string[];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Company Test', email: `company-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });

    originalCompany = await prisma.companyProfile.findUnique({ where: { id: COMPANY_PROFILE_ID } });
    originalFiles = existsSync(uploadsDir) ? readdirSync(uploadsDir) : [];
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });

    if (originalCompany) {
      await prisma.companyProfile.update({
        where: { id: COMPANY_PROFILE_ID },
        data: {
          name: originalCompany.name,
          phone: originalCompany.phone,
          email: originalCompany.email,
          address: originalCompany.address,
          logoPath: originalCompany.logoPath,
        },
      });
    } else {
      await prisma.companyProfile.deleteMany({ where: { id: COMPANY_PROFILE_ID } });
    }

    // Remove only the files this test run created, never anything that was
    // already there.
    if (existsSync(uploadsDir)) {
      for (const file of readdirSync(uploadsDir)) {
        if (!originalFiles.includes(file)) rmSync(path.join(uploadsDir, file), { force: true });
      }
    }
  });

  beforeEach(async () => {
    // Blank slate for each test's own assertions — an update (never a
    // delete), so the row this represents always still exists to be
    // restored from the snapshot above no matter what a test does to it.
    await prisma.companyProfile.upsert({
      where: { id: COMPANY_PROFILE_ID },
      update: { name: null, phone: null, email: null, address: null, logoPath: null },
      create: { id: COMPANY_PROFILE_ID },
    });
  });

  it('GET returns the singleton row with null fields on a blank slate', async () => {
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
      patchReq({ name: 'Test Co', phone: '(555) 000-1111', email: 'test@example.com', address: '1 Test St' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.company.name).toBe('Test Co');
    expect(body.company.address).toBe('1 Test St');
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
    const filePath = path.join(uploadsDir, fileName);
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
    const filePath1 = path.join(uploadsDir, fileName1);
    expect(existsSync(filePath1)).toBe(true);

    const form2 = new FormData();
    form2.set('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'logo2.png');
    await uploadLogo(new Request('http://localhost/api/company/logo', { method: 'POST', body: form2 }) as any);

    expect(existsSync(filePath1)).toBe(false);
  });
});

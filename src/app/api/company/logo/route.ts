import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { getCompanyProfile, companyLogoUrl } from '@/lib/companyProfile';

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof Blob) || !(file.type in EXT_BY_TYPE)) {
    return NextResponse.json({ error: 'file must be a JPEG, PNG, or WebP image' }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'logo must be 2MB or smaller' }, { status: 400 });
  }

  // Not under public/ — see /api/uploads/company/[filename] for why (next
  // start only scans public/ once at boot, so an upload after startup would
  // 404 until a full restart).
  const dir = path.join(process.cwd(), 'uploads', 'company');
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}${EXT_BY_TYPE[file.type]}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, fileName), buffer);

  const existing = await getCompanyProfile(scope.ownerUserId);
  const company = await prisma.companyProfile.update({
    where: { userId: scope.ownerUserId },
    data: { logoPath: fileName },
  });

  await auditScopedMutation(scope, 'CompanyProfile', company.id, 'logo-upload');

  if (existing.logoPath) {
    await unlink(path.join(dir, existing.logoPath)).catch(() => {});
  }

  return NextResponse.json({ company: { ...company, logoUrl: companyLogoUrl(company.logoPath) } });
}

export async function DELETE() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const existing = await getCompanyProfile(scope.ownerUserId);
  const company = await prisma.companyProfile.update({
    where: { userId: scope.ownerUserId },
    data: { logoPath: null },
  });

  await auditScopedMutation(scope, 'CompanyProfile', company.id, 'logo-remove');

  if (existing.logoPath) {
    const dir = path.join(process.cwd(), 'uploads', 'company');
    await unlink(path.join(dir, existing.logoPath)).catch(() => {});
  }

  return NextResponse.json({ company: { ...company, logoUrl: companyLogoUrl(company.logoPath) } });
}
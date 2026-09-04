import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { getCompanyProfile, companyLogoUrl } from '@/lib/companyProfile';

export async function GET() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const company = await getCompanyProfile(scope.ownerUserId);
  return NextResponse.json({ company: { ...company, logoUrl: companyLogoUrl(company.logoPath) } });
}

const patchSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  address: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await getCompanyProfile(scope.ownerUserId); // ensure the row exists before updating it
  const company = await prisma.companyProfile.update({
    where: { userId: scope.ownerUserId },
    data: parsed.data,
  });

  await auditScopedMutation(scope, 'CompanyProfile', company.id, 'update');

  return NextResponse.json({ company: { ...company, logoUrl: companyLogoUrl(company.logoPath) } });
}
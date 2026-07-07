import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCompanyProfile, companyLogoUrl, COMPANY_PROFILE_ID } from '@/lib/companyProfile';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const company = await getCompanyProfile();
  return NextResponse.json({ company: { ...company, logoUrl: companyLogoUrl(company.logoPath) } });
}

const patchSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  address: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await getCompanyProfile(); // ensure the singleton row exists before updating it
  const company = await prisma.companyProfile.update({
    where: { id: COMPANY_PROFILE_ID },
    data: parsed.data,
  });

  return NextResponse.json({ company: { ...company, logoUrl: companyLogoUrl(company.logoPath) } });
}

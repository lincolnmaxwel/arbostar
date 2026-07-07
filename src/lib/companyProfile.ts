import { prisma } from '@/lib/db';

// Singleton row — one deployment is one company, so there's exactly one
// CompanyProfile, always keyed by this fixed id rather than Prisma's usual
// per-record uuid default.
export const COMPANY_PROFILE_ID = 'company';

export async function getCompanyProfile() {
  return prisma.companyProfile.upsert({
    where: { id: COMPANY_PROFILE_ID },
    update: {},
    create: { id: COMPANY_PROFILE_ID },
  });
}

export function companyLogoUrl(logoPath: string | null): string | null {
  return logoPath ? `/api/uploads/company/${logoPath}` : null;
}

import { prisma } from '@/lib/db';

/**
 * Per-user billing/branding profile — the "From" party on quote/invoice
 * documents. Upserts by the owner's userId (the fixed-id 'company' singleton
 * is gone): the future Tenant migration will add `tenantId` to this lookup.
 */
export async function getCompanyProfile(userId: string) {
  return prisma.companyProfile.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export function companyLogoUrl(logoPath: string | null): string | null {
  return logoPath ? `/api/uploads/company/${logoPath}` : null;
}
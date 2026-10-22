import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { getFeatureFlags } from '@/lib/features';
import { getBillingForUser } from '@/lib/billing';
import { companyLogoUrl } from '@/lib/companyProfile';

export const dynamic = 'force-dynamic';

/**
 * Single client-side source for the effective user context: actor identity,
 * effective owner, view-as state, target display name, and feature flags.
 * Drives Header navigation, quote Dexie namespacing, and conditional UI.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const actor = await prisma.user.findUnique({ where: { id: scope.actorUserId } });
  let targetName: string | null = null;
  if (scope.isViewAs) {
    const target = await prisma.user.findUnique({ where: { id: scope.ownerUserId } });
    targetName = target?.name ?? null;
  }

  const features = await getFeatureFlags(scope.ownerUserId);
  const billing = await getBillingForUser(scope.ownerUserId);
  // The signed-in user's own company logo (shown next to their email in the
  // header); read-only, so no profile row is created as a side effect.
  const profile = await prisma.companyProfile.findUnique({
    where: { userId: scope.actorUserId },
    select: { logoPath: true },
  });

  return NextResponse.json({
    actorUserId: scope.actorUserId,
    actorRole: actor?.role ?? null,
    ownerUserId: scope.ownerUserId,
    isViewAs: scope.isViewAs,
    targetName,
    features,
    billing,
    companyLogoUrl: companyLogoUrl(profile?.logoPath ?? null),
    // First-login tour: only for the real user (never while an admin views as someone else).
    tourPending: !scope.isViewAs && actor?.tourCompletedAt === null,
  });
}
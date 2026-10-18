import { NextResponse } from 'next/server';
import { FeatureKey } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hasBillingAccess } from '@/lib/billing';
import { requireUserScope } from '@/lib/userScope';

export type FeatureName = FeatureKey;

/**
 * Feature flags read the user's flag row; missing rows are disabled. An
 * account whose trial/subscription has lapsed (src/lib/billing.ts) has every
 * feature switched off, which is the single choke point for all gated pages
 * and APIs.
 */
/**
 * An admin browsing "as" a user whose trial/subscription lapsed must still see
 * that user's data (that is the point of view-as), so the billing lock does not
 * apply to that one request. Anything else, including no request context at
 * all, keeps the lock.
 */
async function adminViewingAs(userId: string): Promise<boolean> {
  try {
    const scope = await requireUserScope();
    return scope.isViewAs && scope.ownerUserId === userId;
  } catch {
    return false;
  }
}

async function billingAllows(userId: string): Promise<boolean> {
  return (await hasBillingAccess(userId)) || (await adminViewingAs(userId));
}

export async function isFeatureEnabled(userId: string, feature: FeatureName): Promise<boolean> {
  const row = await prisma.userFeatureFlag.findUnique({
    where: { userId_feature: { userId, feature } },
  });
  if (!row?.enabled) return false;
  return billingAllows(userId);
}

export async function getFeatureFlags(userId: string): Promise<Record<FeatureName, boolean>> {
  const flags: Record<FeatureName, boolean> = {
    invoices: false,
    timesheet: false,
    clients_crm: false,
    quotes: false,
  };
  if (!(await billingAllows(userId))) return flags;
  const rows = await prisma.userFeatureFlag.findMany({ where: { userId } });
  for (const row of rows) flags[row.feature] = row.enabled;
  return flags;
}

/** Route-friendly 403 for a feature the effective owner does not have. */
export function featureDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: 'This feature is not enabled for your account.' },
    { status: 403 },
  );
}
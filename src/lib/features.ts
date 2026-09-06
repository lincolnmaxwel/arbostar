import { NextResponse } from 'next/server';
import { FeatureKey } from '@prisma/client';
import { prisma } from '@/lib/db';

export type FeatureName = FeatureKey;

/**
 * Feature flags read the user's flag row; missing rows are disabled.
 */
export async function isFeatureEnabled(userId: string, feature: FeatureName): Promise<boolean> {
  const row = await prisma.userFeatureFlag.findUnique({
    where: { userId_feature: { userId, feature } },
  });
  return row?.enabled ?? false;
}

export async function getFeatureFlags(userId: string): Promise<Record<FeatureName, boolean>> {
  const rows = await prisma.userFeatureFlag.findMany({ where: { userId } });
  const flags: Record<FeatureName, boolean> = {
    invoices: false,
    timesheet: false,
    clients_crm: false,
    quotes: false,
  };
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
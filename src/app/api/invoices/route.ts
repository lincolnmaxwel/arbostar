import { NextResponse } from 'next/server';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';

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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'invoices'))) {
    return featureDisabledResponse();
  }

  // Both sources live in one list: quote invoices and timesheet invoices are
  // owned by the effective user and carry a direct client relation (never
  // resolved through the optional quote).
  const invoices = await prisma.invoice.findMany({
    where: { userId: scope.ownerUserId },
    include: { client: true, quote: { select: { number: true } }, lineItems: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { number: 'desc' },
  });

  return NextResponse.json({ invoices });
}
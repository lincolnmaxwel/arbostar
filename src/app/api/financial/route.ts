import { NextRequest, NextResponse } from 'next/server';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { getFinancialSummary, periodFromSearchParams } from '@/lib/financial';

export async function GET(req: NextRequest) {
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

  const period = periodFromSearchParams(req.nextUrl.searchParams);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });

  const summary = await getFinancialSummary(scope.ownerUserId, period);
  return NextResponse.json(summary);
}

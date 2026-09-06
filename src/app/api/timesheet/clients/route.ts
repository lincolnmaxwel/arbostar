import { NextResponse } from 'next/server';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { listClientsForOwner } from '@/lib/clients';

// Every client owned by the effective user — no confirmed-quote filter
// (unlike /api/clients, which is CRM-gated and only returns clients with a
// scheduled/completed quote). Feeds the timesheet client picker so any
// billable client can be selected or created from that surface.
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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'timesheet'))) {
    return featureDisabledResponse();
  }

  const clients = await listClientsForOwner(scope.ownerUserId);
  return NextResponse.json({ clients });
}
import { NextResponse } from 'next/server';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { getConfirmedClients } from '@/lib/clients';

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

  if (!(await isFeatureEnabled(scope.ownerUserId, 'clients_crm'))) {
    return featureDisabledResponse();
  }

  const clients = await getConfirmedClients(scope.ownerUserId);
  return NextResponse.json({ clients });
}
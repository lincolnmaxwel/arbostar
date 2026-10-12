import { NextResponse } from 'next/server';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { getTrialDays, setTrialDays, MAX_TRIAL_DAYS } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }
  return NextResponse.json({ trialDays: await getTrialDays(), maxTrialDays: MAX_TRIAL_DAYS });
}

export async function PATCH(req: Request) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const body = (await req.json().catch(() => null)) as { trialDays?: unknown } | null;
  const days = body?.trialDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_TRIAL_DAYS) {
    return NextResponse.json(
      { error: `Trial length must be a whole number of days between 0 and ${MAX_TRIAL_DAYS}.` },
      { status: 400 },
    );
  }

  await setTrialDays(days);
  await auditAdminAction(actorId, 'AppSetting', 'trial_days', 'update');
  return NextResponse.json({ trialDays: days });
}

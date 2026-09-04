import { NextResponse } from 'next/server';
import { FeatureKey } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '../../route';

const FEATURES: FeatureKey[] = ['invoices', 'timesheet', 'clients_crm'];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  let body: { feature?: unknown; enabled?: unknown };
  try {
    body = (await req.json()) as { feature?: unknown; enabled?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const feature = body.feature as FeatureKey;
  if (!FEATURES.includes(feature)) {
    return NextResponse.json(
      { error: 'Unknown feature. Valid features: invoices, timesheet, clients_crm.' },
      { status: 400 },
    );
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean.' }, { status: 400 });
  }

  await prisma.userFeatureFlag.upsert({
    where: { userId_feature: { userId: user.id, feature } },
    update: { enabled: body.enabled },
    create: { userId: user.id, feature, enabled: body.enabled },
  });

  await auditAdminAction(actorId, 'UserFeatureFlag', `${user.id}:${feature}`, body.enabled ? 'enable' : 'disable');

  const flags = await prisma.userFeatureFlag.findMany({
    where: { userId: user.id },
    select: { feature: true, enabled: true },
  });
  const flagSet = Object.fromEntries(flags.map((f) => [f.feature, f.enabled]));
  const complete = Object.fromEntries(FEATURES.map((f) => [f, flagSet[f] ?? false]));

  return NextResponse.json({ features: complete });
}
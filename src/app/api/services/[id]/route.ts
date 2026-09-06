import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';

const patchSchema = z.object({
  name: z.string().min(1),
  defaultPrice: z.number().nonnegative(),
  billingType: z.enum(['quantity', 'hourly']).optional(),
  unit: z.string().trim().max(20).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.serviceCatalogItem.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Hourly billing forces unit to null (the unit is implicitly "hour"); a
  // blank unit on a quantity item is stored as null; omitting unit keeps the
  // stored value untouched.
  const data: { name: string; defaultPrice: number; billingType?: 'quantity' | 'hourly'; unit?: string | null } = {
    name: parsed.data.name,
    defaultPrice: parsed.data.defaultPrice,
  };
  if (parsed.data.billingType !== undefined) {
    data.billingType = parsed.data.billingType;
    if (parsed.data.billingType === 'hourly') {
      data.unit = null;
    } else if (parsed.data.unit !== undefined) {
      data.unit = parsed.data.unit || null;
    }
  } else if (parsed.data.unit !== undefined) {
    data.unit = parsed.data.unit || null;
  }

  const item = await prisma.serviceCatalogItem.update({
    where: { id: params.id },
    data,
  });

  await auditScopedMutation(scope, 'ServiceCatalogItem', item.id, 'update');

  return NextResponse.json({ item });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
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

  const existing = await prisma.serviceCatalogItem.findUnique({
    where: { id: params.id, userId: scope.ownerUserId },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.serviceCatalogItem.delete({ where: { id: params.id } });
  await auditScopedMutation(scope, 'ServiceCatalogItem', params.id, 'delete');

  return NextResponse.json({ ok: true });
}

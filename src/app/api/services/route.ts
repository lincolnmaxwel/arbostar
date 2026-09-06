import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { prisma } from '@/lib/db';

const itemSchema = z.object({
  name: z.string().min(1),
  defaultPrice: z.number().nonnegative(),
  billingType: z.enum(['quantity', 'hourly']).default('quantity'),
  unit: z.string().trim().max(20).optional(),
});

// Per-user products/services catalog, priced for quick reuse on timesheet
// entries. Gated by the timesheet feature — it exists to feed that surface.
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

  const items = await prisma.serviceCatalogItem.findMany({
    where: { userId: scope.ownerUserId },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
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
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Hourly billing never uses a unit (the unit is implicitly "hour"); a blank
  // unit on a quantity item is stored as null.
  const unit = parsed.data.billingType === 'hourly' ? null : parsed.data.unit || null;

  const item = await prisma.serviceCatalogItem.create({
    data: {
      userId: scope.ownerUserId,
      name: parsed.data.name,
      defaultPrice: parsed.data.defaultPrice,
      billingType: parsed.data.billingType,
      unit,
    },
  });

  await auditScopedMutation(scope, 'ServiceCatalogItem', item.id, 'create');

  return NextResponse.json({ item }, { status: 201 });
}

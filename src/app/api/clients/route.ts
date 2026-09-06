import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled, featureDisabledResponse } from '@/lib/features';
import { getConfirmedClients } from '@/lib/clients';
import { prisma } from '@/lib/db';

const createClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

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

  if (!((await isFeatureEnabled(scope.ownerUserId, 'clients_crm')) || (await isFeatureEnabled(scope.ownerUserId, 'timesheet')))) {
    return featureDisabledResponse();
  }

  const clients = await getConfirmedClients(scope.ownerUserId);
  return NextResponse.json({ clients });
}

// Manual client creation, aimed at the Timesheet surface (where the picker
// lists every owned client, not just confirmed ones) — gated by the
// timesheet feature for that reason.
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
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const client = await prisma.client.create({
      data: {
        userId: scope.ownerUserId,
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        address: parsed.data.address,
      },
    });

    await auditScopedMutation(scope, 'Client', client.id, 'create');

    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'email-taken', message: 'You already have a client with that email.' },
        { status: 409 },
      );
    }
    throw err;
  }
}
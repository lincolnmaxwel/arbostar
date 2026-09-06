import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, email: true, notificationEmail: true, hourlyRate: true, defaultServiceName: true },
  });

  return NextResponse.json({ user: { ...user, hourlyRate: Number(user.hourlyRate) } });
}

const patchSchema = z.object({
  // Empty string means "clear it, fall back to login email".
  notificationEmail: z.union([z.literal(''), z.string().email()]).optional(),
  hourlyRate: z.number().nonnegative().optional(),
  defaultServiceName: z.string().trim().min(1, 'Service name is required.').optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      notificationEmail: parsed.data.notificationEmail || null,
      ...(parsed.data.hourlyRate !== undefined ? { hourlyRate: parsed.data.hourlyRate } : {}),
      ...(parsed.data.defaultServiceName !== undefined
        ? { defaultServiceName: parsed.data.defaultServiceName }
        : {}),
    },
    select: { name: true, email: true, notificationEmail: true, hourlyRate: true, defaultServiceName: true },
  });

  return NextResponse.json({ user: { ...user, hourlyRate: Number(user.hourlyRate) } });
}
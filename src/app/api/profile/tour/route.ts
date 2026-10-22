import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

const bodySchema = z.object({ done: z.boolean() });

// The signed-in user marks the first-login tour as completed/skipped
// (`done: true`) or asks to see it again (`done: false`). Always the real user,
// never the account an admin is viewing as.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid-body' }, { status: 400 });

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { tourCompletedAt: parsed.data.done ? new Date() : null },
    select: { tourCompletedAt: true },
  });
  return NextResponse.json({ ok: true, tourPending: user.tourCompletedAt === null });
}

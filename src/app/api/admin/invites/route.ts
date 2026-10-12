import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';

export async function GET() {
  try {
    await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const invites = await prisma.userInvite.findMany({
    where: { acceptedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      name: i.name,
      role: i.role,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      expired: i.expiresAt.getTime() <= Date.now(),
    })),
  });
}

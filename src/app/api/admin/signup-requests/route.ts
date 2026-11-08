import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

// Invite-only sign-up queue: requests whose email is confirmed and wait for an
// admin decision, plus the deny list (blocked addresses).
export async function GET() {
  try {
    await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const [pending, blocked] = await Promise.all([
    prisma.pendingSignup.findMany({
      where: { emailVerifiedAt: { not: null }, acceptedAt: null },
      orderBy: { emailVerifiedAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        referral: true,
        createdAt: true,
        emailVerifiedAt: true,
        termsVersion: true,
      },
    }),
    prisma.blockedEmail.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);
  return NextResponse.json({ pending, blocked });
}

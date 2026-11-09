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

  const [pending, blocked, accepted] = await Promise.all([
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
    prisma.pendingSignup.findMany({
      where: { acceptedAt: { not: null } },
      orderBy: { acceptedAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        referral: true,
        createdAt: true,
        emailVerifiedAt: true,
        acceptedAt: true,
      },
    }),
  ]);

  // PendingSignup has no foreign key to User: join by email to show the account
  // the approval created (trial end, custom price, status).
  const users = accepted.length
    ? await prisma.user.findMany({
        where: { email: { in: accepted.map((a) => a.email), mode: 'insensitive' } },
        select: { id: true, email: true, status: true, trialEndsAt: true, customPriceCents: true },
      })
    : [];
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const approved = accepted.map((a) => {
    const user = byEmail.get(a.email.toLowerCase());
    return {
      ...a,
      userId: user?.id ?? null,
      userStatus: user?.status ?? null,
      trialEndsAt: user?.trialEndsAt ?? null,
      customPriceCents: user?.customPriceCents ?? null,
    };
  });
  return NextResponse.json({ pending, blocked, approved });
}

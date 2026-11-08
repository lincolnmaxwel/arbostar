import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';

// Deny a request: the address goes on the deny list (it cannot sign up again
// until an admin removes it there) and the pending row is deleted.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const signup = await prisma.pendingSignup.findUnique({ where: { id: params.id } });
  if (!signup || !signup.emailVerifiedAt || signup.acceptedAt) {
    return NextResponse.json({ error: 'Request not found or already handled.' }, { status: 404 });
  }

  const email = signup.email.toLowerCase();
  const blocked = await prisma.$transaction(async (tx) => {
    const row = await tx.blockedEmail.upsert({
      where: { email },
      create: { email, name: signup.name, phone: signup.phone, referral: signup.referral, blockedById: actorId },
      update: {},
    });
    await tx.pendingSignup.deleteMany({ where: { email } });
    return row;
  });
  await auditAdminAction(actorId, 'BlockedEmail', blocked.id, 'signup-denied');
  return NextResponse.json({ ok: true });
}

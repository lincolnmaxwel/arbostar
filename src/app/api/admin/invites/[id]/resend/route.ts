import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { generateInviteToken, inviteExpiry, inviteUrl, INVITE_TTL_DAYS } from '@/lib/invites';
import { sendInviteEmail } from '@/lib/email';

// Issues a fresh link (the old one stops working) and extends the expiry.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const invite = await prisma.userInvite.findUnique({ where: { id: params.id } });
  if (!invite || invite.acceptedAt) {
    return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
  }

  const { token, tokenHash } = generateInviteToken();
  const updated = await prisma.userInvite.update({
    where: { id: invite.id },
    data: { tokenHash, expiresAt: inviteExpiry() },
  });
  await auditAdminAction(actorId, 'UserInvite', invite.id, 'resend');

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
  const acceptUrl = inviteUrl(token);
  try {
    await sendInviteEmail({
      to: invite.email,
      name: invite.name,
      invitedBy: actor?.name ?? 'An administrator',
      acceptUrl,
      expiresInDays: INVITE_TTL_DAYS,
    });
  } catch (err) {
    console.error('[admin/invites] resend failed', err);
    return NextResponse.json(
      { error: 'The email could not be sent. Share this link manually.', inviteUrl: acceptUrl, expiresAt: updated.expiresAt },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, expiresAt: updated.expiresAt });
}

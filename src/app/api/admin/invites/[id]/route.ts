import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
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

  await prisma.userInvite.delete({ where: { id: invite.id } });
  await auditAdminAction(actorId, 'UserInvite', invite.id, 'revoke');
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';

// Remove an address from the deny list so it can request access again.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }
  const row = await prisma.blockedEmail.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  await prisma.blockedEmail.delete({ where: { id: row.id } });
  await auditAdminAction(actorId, 'BlockedEmail', row.id, 'signup-unblocked');
  return NextResponse.json({ ok: true });
}

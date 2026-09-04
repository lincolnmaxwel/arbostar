import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction, VIEW_AS_COOKIE_NAME } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  let body: { userId?: unknown };
  try {
    body = (await req.json()) as { userId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const targetId = typeof body.userId === 'string' ? body.userId : '';
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  await auditAdminAction(actorId, 'User', target.id, 'view-as-start');

  const res = NextResponse.json({ ok: true, ownerUserId: target.id });
  res.cookies.set(VIEW_AS_COOKIE_NAME, target.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

export async function DELETE() {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  await auditAdminAction(actorId, 'User', actorId, 'view-as-stop');

  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEW_AS_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  return res;
}
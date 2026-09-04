import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '../route';

interface PatchUserBody {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  status?: unknown;
  hourlyRate?: unknown;
  password?: unknown;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  let body: PatchUserBody;
  try {
    body = (await req.json()) as PatchUserBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const data: {
    name?: string;
    email?: string;
    role?: Role;
    status?: UserStatus;
    hourlyRate?: number;
    passwordHash?: string;
  } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
    data.name = name;
  }

  if (body.email !== undefined) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== target.id) {
      return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 });
    }
    data.email = email;
  }

  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'staff') {
      return NextResponse.json({ error: 'Role must be admin or staff.' }, { status: 400 });
    }
    data.role = body.role;
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'inactive' && body.status !== 'blocked') {
      return NextResponse.json({ error: 'Status must be active, inactive, or blocked.' }, { status: 400 });
    }
    data.status = body.status;
  }

  if (body.hourlyRate !== undefined) {
    const rate = typeof body.hourlyRate === 'number' ? body.hourlyRate : NaN;
    if (!Number.isFinite(rate) || rate < 0) {
      return NextResponse.json({ error: 'Hourly rate cannot be negative.' }, { status: 400 });
    }
    data.hourlyRate = rate;
  }

  if (body.password !== undefined) {
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  // Self-lockout guard: an admin can never demote, disable, or block their
  // own account through this endpoint.
  if (target.id === actorId) {
    const nextRole = data.role ?? target.role;
    const nextStatus = data.status ?? target.status;
    if (nextRole !== 'admin' || nextStatus !== 'active') {
      return NextResponse.json(
        { error: 'You cannot demote, disable, or block your own account.' },
        { status: 409 },
      );
    }
  }

  // Last-active-admin guard: never leave the deployment without an active admin.
  const removingAdmin =
    target.role === 'admin' &&
    target.status === 'active' &&
    ((data.role !== undefined && data.role !== 'admin') ||
      (data.status !== undefined && data.status !== 'active'));
  if (removingAdmin) {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: 'admin', status: 'active', id: { not: target.id } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json(
        { error: 'Cannot demote or disable the last active admin.' },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data,
  });

  await auditAdminAction(actorId, 'User', updated.id, 'update');

  return NextResponse.json({
    user: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      status: updated.status,
      hourlyRate: Number(updated.hourlyRate),
    },
  });
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: { featureFlags: { select: { feature: true, enabled: true } } },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      hourlyRate: Number(user.hourlyRate),
      features: Object.fromEntries(user.featureFlags.map((f) => [f.feature, f.enabled])),
    },
    actorId,
  });
}
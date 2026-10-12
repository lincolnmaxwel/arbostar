import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { FeatureKey, Role, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction, UnauthorizedError, ForbiddenError } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { generateInviteToken, inviteExpiry, inviteUrl, INVITE_TTL_DAYS } from '@/lib/invites';
import { sendInviteEmail } from '@/lib/email';

const FEATURES: FeatureKey[] = ['invoices', 'timesheet', 'clients_crm', 'quotes'];
const ROLES: Role[] = ['admin', 'staff'];
const STATUSES: UserStatus[] = ['active', 'inactive', 'blocked'];

interface CreateUserBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  status?: unknown;
  hourlyRate?: unknown;
  features?: unknown;
  /** true: email an invitation instead of setting a password now. */
  sendInvite?: unknown;
}

export async function POST(req: Request) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  let body: CreateUserBody;
  try {
    body = (await req.json()) as CreateUserBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const sendInvite = body.sendInvite === true;
  const role = ROLES.includes(body.role as Role) ? (body.role as Role) : null;
  // An invited user becomes active the moment they accept.
  const status = sendInvite
    ? 'active'
    : STATUSES.includes(body.status as UserStatus)
      ? (body.status as UserStatus)
      : null;
  const hourlyRate = typeof body.hourlyRate === 'number' && Number.isFinite(body.hourlyRate) ? body.hourlyRate : 0;
  const features =
    Array.isArray(body.features) && body.features.every((f) => FEATURES.includes(f as FeatureKey))
      ? (body.features as FeatureKey[])
      : [];

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (!sendInvite && password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: 'Role must be admin or staff.' }, { status: 400 });
  }
  if (!status) {
    return NextResponse.json({ error: 'Status must be active, inactive, or blocked.' }, { status: 400 });
  }
  if (hourlyRate < 0) {
    return NextResponse.json({ error: 'Hourly rate cannot be negative.' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 });
  }

  if (sendInvite) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    // One live invitation per email: a new one replaces any pending one.
    // Housekeeping in the same place: drop invitations that expired or were
    // accepted more than 30 days ago so the table cannot grow without bound.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.userInvite.deleteMany({
      where: {
        OR: [
          { email, acceptedAt: null },
          { acceptedAt: { lt: cutoff } },
          { acceptedAt: null, expiresAt: { lt: cutoff } },
        ],
      },
    });
    const { token, tokenHash } = generateInviteToken();
    const invite = await prisma.userInvite.create({
      data: { email, name, role, hourlyRate, features, tokenHash, expiresAt: inviteExpiry(), invitedById: actorId },
    });
    await auditAdminAction(actorId, 'UserInvite', invite.id, 'create');

    const acceptUrl = inviteUrl(token);
    let emailSent = true;
    try {
      await sendInviteEmail({
        to: email,
        name,
        invitedBy: actor?.name ?? 'An administrator',
        acceptUrl,
        expiresInDays: INVITE_TTL_DAYS,
      });
    } catch (err) {
      emailSent = false;
      console.error('[admin/users] sendInviteEmail failed', err);
    }

    // The link goes back to the admin only when the email could not be
    // delivered, so they can share it by hand.
    return NextResponse.json(
      {
        invite: { id: invite.id, email, name, expiresAt: invite.expiresAt },
        emailSent,
        ...(emailSent ? {} : { inviteUrl: acceptUrl }),
      },
      { status: 201 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      status,
      hourlyRate,
      featureFlags: {
        create: features.map((feature) => ({ feature, enabled: true })),
      },
    },
    include: { featureFlags: { select: { feature: true, enabled: true } } },
  });

  await auditAdminAction(actorId, 'User', user.id, 'create');

  return NextResponse.json({ user: serializeUser(user) }, { status: 201 });
}

export async function GET() {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { featureFlags: { select: { feature: true, enabled: true } } },
  });

  return NextResponse.json({
    users: users.map((u) => serializeUser(u)),
    actorId,
  });
}

function serializeUser(u: {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  hourlyRate: unknown;
  createdAt: Date;
  featureFlags?: { feature: FeatureKey; enabled: boolean }[];
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    hourlyRate: Number(u.hourlyRate),
    createdAt: u.createdAt,
    features: Object.fromEntries(
      FEATURES.map((f) => [f, u.featureFlags?.find((ff) => ff.feature === f)?.enabled ?? false]),
    ),
  };
}
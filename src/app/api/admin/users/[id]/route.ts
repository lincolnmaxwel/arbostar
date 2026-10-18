import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import path from 'path';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { deleteUserCascade } from '@/lib/cascadeDelete';
import { describeStripeError, stripeConfigured } from '@/lib/stripe';
import { PRICE_RANGE_MESSAGE, setUserPrice, validPriceCents } from '@/lib/planPrice';

interface PatchUserBody {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  status?: unknown;
  hourlyRate?: unknown;
  password?: unknown;
  billingExempt?: unknown;
  /** Push the trial end out by this many days (from today if it already lapsed). */
  extendTrialDays?: unknown;
  /** Set the trial end to an exact moment (ISO string); may shorten or extend. */
  trialEndsAt?: unknown;
  /** Own subscription price in cents; null goes back to the default plan price. */
  customPriceCents?: unknown;
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
    sessionId?: string;
    billingExempt?: boolean;
    trialEndsAt?: Date;
    customPriceId?: string | null;
    customPriceCents?: number | null;
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

  if (body.billingExempt !== undefined) {
    if (typeof body.billingExempt !== 'boolean') {
      return NextResponse.json({ error: 'billingExempt must be true or false.' }, { status: 400 });
    }
    data.billingExempt = body.billingExempt;
  }

  if (body.trialEndsAt !== undefined) {
    if (body.extendTrialDays !== undefined) {
      return NextResponse.json({ error: 'Send either trialEndsAt or extendTrialDays, not both.' }, { status: 400 });
    }
    const parsed = typeof body.trialEndsAt === 'string' ? new Date(body.trialEndsAt) : null;
    const max = Date.now() + 5 * 365 * 24 * 60 * 60 * 1000;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 2020 || parsed.getTime() > max) {
      return NextResponse.json({ error: 'Enter a valid trial end date (not more than 5 years ahead).' }, { status: 400 });
    }
    data.trialEndsAt = parsed;
  }

  if (body.extendTrialDays !== undefined) {
    const days = body.extendTrialDays;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: 'Trial extension must be a whole number of days between 1 and 365.' }, { status: 400 });
    }
    const base = Math.max(Date.now(), target.trialEndsAt?.getTime() ?? 0);
    data.trialEndsAt = new Date(base + days * 24 * 60 * 60 * 1000);
  }

  if (body.customPriceCents !== undefined) {
    if (body.customPriceCents !== null && !validPriceCents(body.customPriceCents)) {
      return NextResponse.json({ error: PRICE_RANGE_MESSAGE }, { status: 400 });
    }
    if (!stripeConfigured()) {
      return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
    }
    try {
      Object.assign(data, await setUserPrice(target, body.customPriceCents));
    } catch (err) {
      const { code } = describeStripeError('set user price', err);
      return NextResponse.json({ error: `Could not change the price in Stripe${code ? ` (${code})` : ''}.` }, { status: 502 });
    }
  }

  if (body.password !== undefined) {
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(password, 10);
    // A new password ends every open session of that user (not the admin's own).
    if (target.id !== actorId) data.sessionId = randomUUID();
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

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    include: { companyProfile: { select: { logoPath: true } } },
  });
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  // Self-delete guard: an admin can never remove their own account here.
  if (target.id === actorId) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 409 });
  }

  // Last-active-admin guard (same rule as the PATCH status/role demotion):
  // never leave the deployment without an active admin.
  if (target.role === 'admin' && target.status === 'active') {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: 'admin', status: 'active', id: { not: target.id } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: 'Cannot delete the last active admin.' }, { status: 409 });
    }
  }

  const { quoteIds } = await deleteUserCascade(target.id);

  await auditAdminAction(actorId, 'User', target.id, 'delete');

  // Clean up files the database doesn't track: quote photo directories and
  // the user's company logo.
  for (const quoteId of quoteIds) {
    const dir = path.join(process.cwd(), 'uploads', 'quotes', quoteId);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  if (target.companyProfile?.logoPath) {
    const logoDir = path.join(process.cwd(), 'uploads', 'company');
    await rm(path.join(logoDir, target.companyProfile.logoPath), { force: true }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
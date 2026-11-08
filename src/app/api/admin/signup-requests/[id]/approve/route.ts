import { NextResponse } from 'next/server';
import { FeatureKey } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { MAX_TRIAL_DAYS } from '@/lib/billing';
import { PRICE_RANGE_MESSAGE, ensurePrice, getDefaultPriceId, validPriceCents } from '@/lib/planPrice';
import { describeStripeError, stripeConfigured } from '@/lib/stripe';
import { sendSignupApprovedEmail } from '@/lib/email';
import { appBaseUrl } from '@/lib/emailLayout';

// The same default feature set an admin-created staff user gets.
const DEFAULT_FEATURES: FeatureKey[] = ['invoices', 'timesheet', 'clients_crm', 'quotes'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Approve a confirmed sign-up request: creates the account with the trial
// length and monthly price the admin chose, then emails the person.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const body = (await req.json().catch(() => null)) as { trialDays?: unknown; priceCents?: unknown } | null;
  const trialDays = body?.trialDays;
  if (typeof trialDays !== 'number' || !Number.isInteger(trialDays) || trialDays < 0 || trialDays > MAX_TRIAL_DAYS) {
    return NextResponse.json(
      { error: `Trial length must be a whole number of days from 0 to ${MAX_TRIAL_DAYS}.` },
      { status: 400 },
    );
  }
  // null/undefined = use the default plan price.
  const priceCents = body?.priceCents ?? null;
  if (priceCents !== null && !validPriceCents(priceCents)) {
    return NextResponse.json({ error: PRICE_RANGE_MESSAGE }, { status: 400 });
  }

  const signup = await prisma.pendingSignup.findUnique({ where: { id: params.id } });
  if (!signup || !signup.emailVerifiedAt || signup.acceptedAt) {
    return NextResponse.json({ error: 'Request not found or already handled.' }, { status: 404 });
  }
  if (!signup.passwordHash) {
    return NextResponse.json({ error: 'This request has no password and cannot be approved.' }, { status: 410 });
  }
  const existing = await prisma.user.findFirst({
    where: { email: { equals: signup.email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  let customPriceId: string | null = null;
  if (priceCents !== null) {
    if (!stripeConfigured()) {
      return NextResponse.json({ error: 'Stripe is not configured, so a custom price cannot be set.' }, { status: 503 });
    }
    try {
      customPriceId = await ensurePrice(await getDefaultPriceId(), priceCents);
    } catch (err) {
      const { code } = describeStripeError('approve signup price', err);
      return NextResponse.json(
        { error: `Could not set the price in Stripe${code ? ` (${code})` : ''}.` },
        { status: 502 },
      );
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    const burned = await tx.pendingSignup.updateMany({
      where: { id: signup.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (burned.count !== 1) return null;
    return tx.user.create({
      data: {
        name: signup.name,
        email: signup.email,
        passwordHash: signup.passwordHash!,
        role: 'staff',
        status: 'active',
        trialEndsAt: new Date(Date.now() + trialDays * DAY_MS),
        customPriceId,
        customPriceCents: priceCents,
        termsAcceptedAt: signup.createdAt,
        termsVersion: signup.termsVersion,
        featureFlags: { create: DEFAULT_FEATURES.map((feature) => ({ feature, enabled: true })) },
      },
    });
  });
  if (!user) {
    return NextResponse.json({ error: 'Request not found or already handled.' }, { status: 404 });
  }
  await auditAdminAction(actorId, 'User', user.id, 'signup-approved');

  let emailSent = true;
  try {
    await sendSignupApprovedEmail({ to: user.email, name: user.name, loginUrl: `${appBaseUrl()}/login`, trialDays });
  } catch (err) {
    emailSent = false;
    console.error('[signup-approve] email failed', err);
  }
  return NextResponse.json({ ok: true, userId: user.id, emailSent }, { status: 201 });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { evaluateBilling } from '@/lib/billing';
import { getPlanPrice } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Admin overview of every account's subscription / trial state.
export async function GET() {
  try {
    await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const [users, plan] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
    getPlanPrice(),
  ]);

  const subscriptions = users.map((u) => {
    const b = evaluateBilling(u);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      accountStatus: u.status,
      createdAt: u.createdAt,
      billingExempt: u.billingExempt,
      phase: b.phase,
      access: b.access,
      subscriptionStatus: b.subscriptionStatus,
      trialEndsAt: b.trialEndsAt,
      periodEnd: b.periodEnd,
      daysLeft: b.daysLeft,
      cancelAtPeriodEnd: b.cancelAtPeriodEnd,
      autoRenews: b.autoRenews,
      stripeCustomerId: u.stripeCustomerId,
      stripeSubscriptionId: u.stripeSubscriptionId,
    };
  });

  const count = (fn: (s: (typeof subscriptions)[number]) => boolean) => subscriptions.filter(fn).length;
  const summary = {
    total: subscriptions.length,
    subscribed: count((s) => s.phase === 'subscribed'),
    trial: count((s) => s.phase === 'trial'),
    pastDue: count((s) => s.phase === 'past_due'),
    locked: count((s) => s.phase === 'trial_ended' || s.phase === 'canceled'),
    exempt: count((s) => s.phase === 'exempt'),
  };

  return NextResponse.json({
    subscriptions,
    summary,
    plan,
    // Lets the UI build the right Stripe dashboard links (sandbox vs live).
    stripeMode: (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_') ? 'live' : 'test',
  });
}

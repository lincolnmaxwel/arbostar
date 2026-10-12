import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { getStripe, syncSubscription, syncSubscriptionById } from '@/lib/stripe';
import { sendPaymentFailedEmail } from '@/lib/email';
import { appBaseUrl } from '@/lib/emailLayout';

export const dynamic = 'force-dynamic';

// Public endpoint (outside the auth middleware): the Stripe signature over the
// raw body is the only credential. Every handler is idempotent because Stripe
// retries and may deliver events out of order, so subscription state is always
// re-read from Stripe rather than trusted from the event payload.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          await syncSubscriptionById(subId);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscriptionById(sub.id, sub);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
          if (user) {
            try {
              await sendPaymentFailedEmail({
                to: user.email,
                name: user.name,
                billingUrl: `${appBaseUrl()}/billing`,
              });
            } catch (err) {
              // The reminder is a courtesy; never fail the webhook over it.
              console.error('[stripe/webhook] payment-failed email failed', err);
            }
          }
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[stripe/webhook] handler failed', event.type, err);
    // 500 makes Stripe retry later.
    return NextResponse.json({ error: 'Webhook handler failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { sendQuoteDecisionNotificationEmail } from '@/lib/email';

const respondSchema = z.object({ decision: z.enum(['approve', 'decline']) });

// No auth check here by design: the long, random publicToken IS the
// credential. Anyone with the link can respond to that one quote — the same
// model the reference Arbostar portal link uses.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const quote = await prisma.quote.findUnique({
    where: { publicToken: params.token },
    include: { client: true, createdBy: true },
  });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (quote.status !== 'sent') {
    // Already responded (or not yet sent to begin with): return the current
    // status idempotently rather than erroring, so a double-click or a
    // refresh after responding doesn't surface a confusing failure.
    return NextResponse.json({ status: quote.status });
  }

  const status = parsed.data.decision === 'approve' ? 'approved' : 'declined';
  await prisma.quote.update({
    where: { id: quote.id },
    data: { status, respondedAt: new Date() },
  });

  try {
    await sendQuoteDecisionNotificationEmail({
      to: quote.createdBy.notificationEmail || quote.createdBy.email,
      clientName: quote.client.name,
      clientPhone: quote.client.phone ?? undefined,
      serviceAddress: quote.serviceAddress ?? undefined,
      quoteNumber: quote.number,
      decision: status,
      quoteUrl: `${process.env.NEXTAUTH_URL}/quotes/${quote.draftId}`,
    });
  } catch (err) {
    // The client's decision is already persisted; a notification failure
    // shouldn't turn into a 5xx for the client-facing portal.
    console.error('[portal] sendQuoteDecisionNotificationEmail failed', err);
  }

  return NextResponse.json({ status });
}

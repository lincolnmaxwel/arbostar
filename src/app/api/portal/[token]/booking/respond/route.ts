import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { sendBookingDecisionNotificationEmail } from '@/lib/email';

const respondSchema = z
  .object({
    decision: z.enum(['confirm', 'reject']),
    optionId: z.string().uuid().optional(),
    reason: z.string().optional(),
  })
  .refine((d) => d.decision === 'confirm' || (d.reason ?? '').length >= 3, {
    message: 'reason must be at least 3 characters when rejecting',
    path: ['reason'],
  })
  .refine((d) => d.decision === 'reject' || (d.optionId ?? '').length > 0, {
    message: 'optionId is required when confirming',
    path: ['optionId'],
  });

// No auth check by design — the long random publicToken IS the credential,
// exactly like the sibling /api/portal/[token]/respond route for approve/decline.
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

  // Idempotency: if the quote has already moved past 'proposed' on the booking
  // loop, return current state without re-flipping. Mirrors /respond/route.ts.
  if (quote.status !== 'approved' || quote.bookingStatus !== 'proposed') {
    return NextResponse.json({ status: quote.status, bookingStatus: quote.bookingStatus });
  }

  const activeRound = await prisma.scheduleRound.findFirst({
    where: { quoteId: quote.id, status: 'proposed' },
    orderBy: { roundNumber: 'desc' },
    include: { options: true },
  });
  if (!activeRound) {
    // Defensive — should be unreachable if bookingStatus='proposed' is consistent
    // with a round existing. Surface a 409 so a bug here doesn't silently pass.
    return NextResponse.json({ error: 'no-active-round' }, { status: 409 });
  }

  if (parsed.data.decision === 'confirm') {
    const optionId = parsed.data.optionId!;
    const option = activeRound.options.find((o) => o.id === optionId);
    if (!option) {
      return NextResponse.json({ error: 'option-not-in-round' }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.scheduleOption.updateMany({ where: { roundId: activeRound.id }, data: { chosen: false } }),
      prisma.scheduleOption.update({ where: { id: option.id }, data: { chosen: true } }),
      prisma.scheduleRound.update({
        where: { id: activeRound.id },
        data: { status: 'confirmed', respondedAt: new Date() },
      }),
      prisma.quote.update({
        where: { id: quote.id },
        data: {
          bookingStatus: 'confirmed',
          status: 'scheduled',
          scheduledDate: option.proposedDate,
          scheduledWindow: option.window,
        },
      }),
    ]);

    try {
      await sendBookingDecisionNotificationEmail({
        to: quote.createdBy.notificationEmail || quote.createdBy.email,
        clientName: quote.client.name,
        clientPhone: quote.client.phone ?? undefined,
        serviceAddress: quote.serviceAddress ?? undefined,
        quoteNumber: quote.number,
        quoteUrl: `${process.env.NEXTAUTH_URL}/quotes/${quote.draftId}`,
        decision: 'confirmed',
        scheduledDate: option.proposedDate.toISOString().slice(0, 10),
        scheduledWindow: option.window,
      });
    } catch (err) {
      console.error('[portal] sendBookingDecisionNotificationEmail failed', err);
    }

    return NextResponse.json({ status: 'scheduled', bookingStatus: 'confirmed' });
  }

  // decision === 'reject'
  const reason = parsed.data.reason!.slice(0, 2000); // bound at 2k chars to prevent abuse
  await prisma.$transaction([
    prisma.scheduleRound.update({
      where: { id: activeRound.id },
      data: { status: 'rejected', rejectionReason: reason, respondedAt: new Date() },
    }),
    prisma.quote.update({
      where: { id: quote.id },
      data: { bookingStatus: 'rejected' },
    }),
  ]);

  try {
    await sendBookingDecisionNotificationEmail({
      to: quote.createdBy.notificationEmail || quote.createdBy.email,
      clientName: quote.client.name,
      clientPhone: quote.client.phone ?? undefined,
      serviceAddress: quote.serviceAddress ?? undefined,
      quoteNumber: quote.number,
      quoteUrl: `${process.env.NEXTAUTH_URL}/quotes/${quote.draftId}`,
      decision: 'rejected',
      rejectionReason: reason,
    });
  } catch (err) {
    console.error('[portal] sendBookingDecisionNotificationEmail failed', err);
  }

  return NextResponse.json({ status: 'approved', bookingStatus: 'rejected' });
}

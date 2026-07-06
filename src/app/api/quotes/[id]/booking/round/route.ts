import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sendBookingProposalEmail } from '@/lib/email';

const roundSchema = z.object({
  options: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        window: z.enum(['morning', 'afternoon', 'fullday']),
      }),
    )
    .min(1)
    .max(3),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = roundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { client: true },
  });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (quote.status !== 'approved') {
    return NextResponse.json({ error: quote.status === 'scheduled' ? 'already-scheduled' : 'not-approved' }, { status: 409 });
  }
  if (quote.bookingStatus === 'proposed') {
    return NextResponse.json({ error: 'round-already-active' }, { status: 409 });
  }
  if (quote.bookingStatus === 'confirmed') {
    return NextResponse.json({ error: 'already-scheduled' }, { status: 409 });
  }

  // bookingStatus is now 'idle' or 'rejected' — both permit a new round.
  const lastRound = await prisma.scheduleRound.aggregate({
    where: { quoteId: quote.id },
    _max: { roundNumber: true },
  });
  const nextRoundNumber = (lastRound._max.roundNumber ?? 0) + 1;

  const round = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: nextRoundNumber,
        status: 'proposed',
        options: {
          create: parsed.data.options.map((o) => ({
            proposedDate: new Date(o.date + 'T12:00:00.000Z'),
            window: o.window,
          })),
        },
      },
      include: { options: true },
    });
    await tx.quote.update({
      where: { id: quote.id },
      data: { bookingStatus: 'proposed' },
    });
    return created;
  });

  const portalUrl = `${process.env.NEXTAUTH_URL}/portal/${quote.publicToken}`;
  try {
    await sendBookingProposalEmail({
      to: quote.client.email,
      clientName: quote.client.name,
      portalUrl,
      roundNumber: nextRoundNumber,
      options: parsed.data.options,
    });
  } catch (err) {
    // Round is already persisted; email failure is logged but not surfaced to
    // staff as a 5xx — the client can still be pointed at the portal link
    // manually. A future sub-project can add a resend affordance.
    console.error('[booking] sendBookingProposalEmail failed', err);
  }

  return NextResponse.json({ roundId: round.id }, { status: 201 });
}

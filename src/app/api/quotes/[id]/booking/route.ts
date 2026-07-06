import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      bookingStatus: true,
      scheduledDate: true,
      scheduledWindow: true,
    },
  });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const latestRound = await prisma.scheduleRound.findFirst({
    where: { quoteId: params.id },
    orderBy: { roundNumber: 'desc' },
    include: { options: { orderBy: { proposedDate: 'asc' } } },
  });

  return NextResponse.json({
    quote: {
      ...quote,
      scheduledDate: quote.scheduledDate ? quote.scheduledDate.toISOString() : null,
    },
    latestRound: latestRound
      ? {
          id: latestRound.id,
          roundNumber: latestRound.roundNumber,
          status: latestRound.status,
          rejectionReason: latestRound.rejectionReason,
          proposedAt: latestRound.proposedAt.toISOString(),
          respondedAt: latestRound.respondedAt ? latestRound.respondedAt.toISOString() : null,
          options: latestRound.options.map((o) => ({
            id: o.id,
            proposedDate: o.proposedDate.toISOString().slice(0, 10),
            window: o.window,
            chosen: o.chosen,
          })),
        }
      : null,
  });
}

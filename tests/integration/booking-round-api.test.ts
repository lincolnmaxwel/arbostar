import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendQuoteApprovalEmail: vi.fn().mockResolvedValue(undefined),
  sendBookingProposalEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { sendBookingProposalEmail } from '@/lib/email';
import { GET as getBooking, POST as createRound } from '@/app/api/quotes/[id]/booking/round/route';
import { GET as getBookingState } from '@/app/api/quotes/[id]/booking/route';
import { prisma } from '@/lib/db';

describe('Staff booking API', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Booking Staff', email: `booking-staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });

    const client = await prisma.client.create({
      data: { name: 'Booking Client', email: `booking-client-${randomUUID()}@example.com` },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  beforeEach(() => {
    (sendBookingProposalEmail as ReturnType<typeof vi.fn>).mockClear();
  });

  async function createApprovedQuote(bookingStatus: 'idle' | 'rejected' = 'idle') {
    const draftId = randomUUID();
    return prisma.quote.create({
      data: {
        draftId,
        clientId,
        createdById: userId,
        status: 'approved',
        bookingStatus,
        items: { create: [{ localItemId: randomUUID(), title: 'Tree removal', price: 500, sortOrder: 0 }] },
      },
    });
  }

  function postRound(quoteId: string, options: Array<{ date: string; window: string }>) {
    return createRound(
      new Request(`http://localhost/api/quotes/${quoteId}/booking/round`, {
        method: 'POST',
        body: JSON.stringify({ options }),
      }) as any,
      { params: { id: quoteId } },
    );
  }

  it('POST: creates a round + options, flips bookingStatus to proposed, sends email', async () => {
    const quote = await createApprovedQuote('idle');

    const res = await postRound(quote.id, [
      { date: '2099-07-15', window: 'morning' },
      { date: '2099-07-17', window: 'fullday' },
    ]);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.roundId).toBeTruthy();

    const round = await prisma.scheduleRound.findUniqueOrThrow({
      where: { id: body.roundId },
      include: { options: true },
    });
    expect(round.roundNumber).toBe(1);
    expect(round.status).toBe('proposed');
    expect(round.options).toHaveLength(2);
    expect(round.options.map((o) => o.window).sort()).toEqual(['fullday', 'morning']);

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.bookingStatus).toBe('proposed');

    expect(sendBookingProposalEmail).toHaveBeenCalledTimes(1);
    const call = (sendBookingProposalEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.to).toContain('booking-client-');
    expect(call.roundNumber).toBe(1);
    expect(call.options).toHaveLength(2);
  });

  it('POST: 409 when a round is already proposed (idempotency on double-submit)', async () => {
    const quote = await createApprovedQuote('idle');
    await postRound(quote.id, [{ date: '2099-08-01', window: 'morning' }]);

    const res = await postRound(quote.id, [{ date: '2099-08-05', window: 'afternoon' }]);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('round-already-active');

    const rounds = await prisma.scheduleRound.findMany({ where: { quoteId: quote.id } });
    expect(rounds).toHaveLength(1);
  });

  it('POST: 409 when booking is already confirmed', async () => {
    const quote = await createApprovedQuote('idle');
    await prisma.quote.update({ where: { id: quote.id }, data: { bookingStatus: 'confirmed', status: 'scheduled' } });

    const res = await postRound(quote.id, [{ date: '2099-09-01', window: 'morning' }]);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already-scheduled');
  });

  it('POST: creates round N+1 after a rejection, with correct roundNumber', async () => {
    const quote = await createApprovedQuote('rejected');
    // Seed an existing rejected round 1
    await prisma.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: 1,
        status: 'rejected',
        rejectionReason: 'No good days',
        respondedAt: new Date(),
        options: { create: [{ proposedDate: new Date('2099-06-01'), window: 'morning' }] },
      },
    });

    const res = await postRound(quote.id, [{ date: '2099-07-20', window: 'afternoon' }]);
    expect(res.status).toBe(201);
    const body = await res.json();

    const round = await prisma.scheduleRound.findUniqueOrThrow({
      where: { id: body.roundId },
    });
    expect(round.roundNumber).toBe(2);
    expect(round.status).toBe('proposed');

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.bookingStatus).toBe('proposed');
  });

  it('POST: 400 on malformed body (4 options, or bad window, or bad date)', async () => {
    const quote = await createApprovedQuote('idle');

    const tooMany = await postRound(quote.id, [
      { date: '2099-07-15', window: 'morning' },
      { date: '2099-07-16', window: 'morning' },
      { date: '2099-07-17', window: 'morning' },
      { date: '2099-07-18', window: 'morning' },
    ]);
    expect(tooMany.status).toBe(400);

    const badWindow = await postRound(quote.id, [{ date: '2099-07-15', window: 'evening' }]);
    expect(badWindow.status).toBe(400);

    const badDate = await postRound(quote.id, [{ date: 'not-a-date', window: 'morning' }]);
    expect(badDate.status).toBe(400);
  });

  it('POST: 404 for unknown quote id', async () => {
    const res = await postRound('00000000-0000-0000-0000-000000000000', [{ date: '2099-07-15', window: 'morning' }]);
    expect(res.status).toBe(404);
  });

  it('GET: returns booking state with latest round + options', async () => {
    const quote = await createApprovedQuote('idle');
    await postRound(quote.id, [{ date: '2099-07-15', window: 'morning' }]);

    const res = await getBookingState(
      new Request(`http://localhost/api/quotes/${quote.id}/booking`) as any,
      { params: { id: quote.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote.id).toBe(quote.id);
    expect(body.quote.bookingStatus).toBe('proposed');
    expect(body.latestRound.roundNumber).toBe(1);
    expect(body.latestRound.status).toBe('proposed');
    expect(body.latestRound.options).toHaveLength(1);
  });

  it('GET: returns latestRound null when no rounds exist', async () => {
    const quote = await createApprovedQuote('idle');
    const res = await getBookingState(
      new Request(`http://localhost/api/quotes/${quote.id}/booking`) as any,
      { params: { id: quote.id } },
    );
    const body = await res.json();
    expect(body.latestRound).toBeNull();
    expect(body.quote.bookingStatus).toBe('idle');
  });
});

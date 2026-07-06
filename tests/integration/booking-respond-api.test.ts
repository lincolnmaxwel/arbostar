import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { POST } from '@/app/api/portal/[token]/booking/respond/route';
import { prisma } from '@/lib/db';

describe('POST /api/portal/[token]/booking/respond', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Portal Booking Test', email: `pb-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    const client = await prisma.client.create({
      data: { name: 'Portal Client', email: `pc-${randomUUID()}@example.com` },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function createProposedQuote() {
    const draftId = randomUUID();
    const quote = await prisma.quote.create({
      data: {
        draftId,
        clientId,
        createdById: userId,
        status: 'approved',
        bookingStatus: 'proposed',
        items: { create: [{ localItemId: randomUUID(), title: 'Tree removal', price: 500, sortOrder: 0 }] },
      },
    });
    const round = await prisma.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: 1,
        status: 'proposed',
        options: {
          create: [
            { proposedDate: new Date('2099-07-15T12:00:00.000Z'), window: 'morning' },
            { proposedDate: new Date('2099-07-17T12:00:00.000Z'), window: 'fullday' },
          ],
        },
      },
      include: { options: true },
    });
    return { quote, round, options: round.options };
  }

  function respond(token: string, body: unknown) {
    return POST(
      new Request(`http://localhost/api/portal/${token}/booking/respond`, {
        method: 'POST',
        body: JSON.stringify(body),
      }) as any,
      { params: { token } },
    );
  }

  it('confirms an option: flips bookingStatus=confirmed, Quote.status=scheduled, marks option chosen, mirrors scheduledDate/Window', async () => {
    const { quote, options } = await createProposedQuote();
    const chosen = options[0];

    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: chosen.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('scheduled');
    expect(body.bookingStatus).toBe('confirmed');

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.status).toBe('scheduled');
    expect(updated.bookingStatus).toBe('confirmed');
    expect(updated.scheduledDate?.toISOString().slice(0, 10)).toBe('2099-07-15');
    expect(updated.scheduledWindow).toBe('morning');

    const round = await prisma.scheduleRound.findUniqueOrThrow({
      where: { id: chosen.roundId },
      include: { options: true },
    });
    expect(round.status).toBe('confirmed');
    expect(round.respondedAt).not.toBeNull();
    const chosenOpt = round.options.find((o) => o.id === chosen.id);
    const otherOpt = round.options.find((o) => o.id !== chosen.id);
    expect(chosenOpt?.chosen).toBe(true);
    expect(otherOpt?.chosen).toBe(false);
  });

  it('is idempotent on confirm: second confirm does not re-flip or error', async () => {
    const { quote, options } = await createProposedQuote();
    await respond(quote.publicToken, { decision: 'confirm', optionId: options[0].id });
    const firstRespondedAt = (await prisma.scheduleRound.findFirstOrThrow({ where: { quoteId: quote.id } })).respondedAt;

    // Second confirm with the OTHER option id — must not re-flip to that option.
    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: options[1].id });
    expect(res.status).toBe(200);
    expect((await res.json()).bookingStatus).toBe('confirmed');

    const round = await prisma.scheduleRound.findFirstOrThrow({
      where: { quoteId: quote.id },
      include: { options: true },
    });
    expect(round.respondedAt?.getTime()).toBe(firstRespondedAt?.getTime());
    expect(round.options.find((o) => o.id === options[0].id)?.chosen).toBe(true);
    expect(round.options.find((o) => o.id === options[1].id)?.chosen).toBe(false);
  });

  it('rejects all options with a reason: bookingStatus=rejected, reason saved, Quote.status stays approved', async () => {
    const { quote, round } = await createProposedQuote();

    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'None of those days work for me.' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(body.bookingStatus).toBe('rejected');

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.status).toBe('approved');
    expect(updated.bookingStatus).toBe('rejected');

    const updatedRound = await prisma.scheduleRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(updatedRound.status).toBe('rejected');
    expect(updatedRound.rejectionReason).toBe('None of those days work for me.');
    expect(updatedRound.respondedAt).not.toBeNull();
  });

  it('is idempotent on reject: second reject does not overwrite the first reason', async () => {
    const { quote, round } = await createProposedQuote();
    await respond(quote.publicToken, { decision: 'reject', reason: 'First reason.' });
    const firstReason = (await prisma.scheduleRound.findUniqueOrThrow({ where: { id: round.id } })).rejectionReason;

    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'Second reason.' });
    expect(res.status).toBe(200);

    const after = await prisma.scheduleRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.rejectionReason).toBe(firstReason);
  });

  it('returns 400 when rejecting without a reason (Zod refine)', async () => {
    const { quote } = await createProposedQuote();
    const res = await respond(quote.publicToken, { decision: 'reject' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rejecting with a reason shorter than 3 chars', async () => {
    const { quote } = await createProposedQuote();
    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'no' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when optionId does not belong to the active round', async () => {
    const { quote } = await createProposedQuote();
    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await respond('does-not-exist', { decision: 'confirm', optionId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('returns current state idempotently when quote is not in proposed state (e.g. already scheduled)', async () => {
    const { quote } = await createProposedQuote();
    await prisma.quote.update({ where: { id: quote.id }, data: { bookingStatus: 'confirmed', status: 'scheduled' } });

    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'should not flip' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bookingStatus).toBe('confirmed');
    expect(body.status).toBe('scheduled');
  });

  it('after rejection, staff can create a new round (round 2) — verified via direct Prisma call', async () => {
    // Both reject and confirm below now send a real staff-notification email
    // (unmocked, same as this file's other tests) — two round trips in one
    // test can occasionally exceed the default 5s timeout.
    const { quote, round } = await createProposedQuote();
    await respond(quote.publicToken, { decision: 'reject', reason: 'Bad days.' });

    // Simulate staff POST by creating the round directly (the staff endpoint is tested in Task 3).
    const newRound = await prisma.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: 2,
        status: 'proposed',
        options: { create: [{ proposedDate: new Date('2099-08-01T12:00:00.000Z'), window: 'morning' }] },
      },
    });
    await prisma.quote.update({ where: { id: quote.id }, data: { bookingStatus: 'proposed' } });

    expect(newRound.roundNumber).toBe(2);
    expect(newRound.roundNumber).toBeGreaterThan(round.roundNumber);

    // Now the client can confirm an option on round 2.
    const r2 = await prisma.scheduleRound.findUniqueOrThrow({ where: { id: newRound.id }, include: { options: true } });
    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: r2.options[0].id });
    expect(res.status).toBe(200);
    expect((await res.json()).bookingStatus).toBe('confirmed');
  }, 15000);
});

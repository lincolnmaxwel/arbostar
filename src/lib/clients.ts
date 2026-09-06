import { prisma } from '@/lib/db';

// A "real" client — one whose scheduling was actually confirmed at least
// once (not just anyone who ever got a quote drafted, most of which never go
// anywhere), OR one created manually with no quotes at all (via the
// timesheet surface or directly from the clients page). Clients that only
// have pending draft/sent/declined quotes stay hidden until a job is ever
// confirmed. Shared by the Clients page and the new-quote form's client
// picker (GET /api/clients), so both agree on the same definition. Scoped by
// the effective owner so each user sees only their own clients.
export async function getConfirmedClients(ownerUserId: string) {
  const clients = await prisma.client.findMany({
    where: {
      userId: ownerUserId,
      OR: [
        { quotes: { some: { status: { in: ['scheduled', 'completed'] } } } },
        { quotes: { none: {} } },
      ],
    },
    include: {
      _count: { select: { quotes: true } },
      // Client.address is only ever set if someone typed it directly against
      // the Client record — the builder form has no "client address" input,
      // only Service address (per-quote, since a client's job site can
      // differ from their own address). In practice Client.address is
      // almost always empty, so fall back to the most recent confirmed
      // quote's service address rather than showing a blank column.
      quotes: {
        where: { status: { in: ['scheduled', 'completed'] } },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { serviceAddress: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address || c.quotes[0]?.serviceAddress || null,
    quoteCount: c._count.quotes,
  }));
}

/**
 * Every client owned by the user — no confirmed-quote filter. Feeds the
 * timesheet client picker (and manual client creation from that surface),
 * where a client doesn't need a scheduled job to be billable.
 */
export async function listClientsForOwner(ownerUserId: string) {
  const clients = await prisma.client.findMany({
    where: { userId: ownerUserId },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  return clients;
}
import { prisma } from '@/lib/db';

// A "real" client — one whose scheduling was actually confirmed at least
// once, not just anyone who ever got a quote drafted (most of which never go
// anywhere). Shared by the Clients page and the new-quote form's client
// picker (GET /api/clients), so both agree on the same definition.
export async function getConfirmedClients() {
  const clients = await prisma.client.findMany({
    where: { quotes: { some: { status: { in: ['scheduled', 'completed'] } } } },
    include: { _count: { select: { quotes: true } } },
    orderBy: { name: 'asc' },
  });

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    quoteCount: c._count.quotes,
  }));
}

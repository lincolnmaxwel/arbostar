import { prisma } from '../src/lib/db';

async function main() {
  const quotes = await prisma.quote.findMany({
    include: {
      client: true,
      rounds: { orderBy: { roundNumber: 'asc' }, include: { options: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log(`=== ${quotes.length} most recent quotes ===\n`);
  for (const q of quotes) {
    console.log(`Quote #${q.number} (${q.id.slice(0, 8)})`);
    console.log(`  draftId: ${q.draftId.slice(0, 8)}`);
    console.log(`  client: ${q.client.name} <${q.client.email}>`);
    console.log(`  status: ${q.status}`);
    console.log(`  bookingStatus: ${q.bookingStatus}`);
    console.log(`  scheduledDate: ${q.scheduledDate?.toISOString() ?? 'null'}`);
    console.log(`  scheduledWindow: ${q.scheduledWindow ?? 'null'}`);
    console.log(`  publicToken: ${q.publicToken.slice(0, 8)}...`);
    console.log(`  sentAt: ${q.sentAt?.toISOString() ?? 'null'}`);
    console.log(`  respondedAt: ${q.respondedAt?.toISOString() ?? 'null'}`);
    console.log(`  rounds: ${q.rounds.length}`);
    for (const r of q.rounds) {
      console.log(`    round ${r.roundNumber}: status=${r.status}, rejectionReason=${r.rejectionReason ?? 'null'}, options=${r.options.length}`);
      for (const o of r.options) {
        console.log(`      option ${o.id.slice(0, 8)}: date=${o.proposedDate.toISOString().slice(0, 10)}, window=${o.window}, chosen=${o.chosen}`);
      }
    }
    console.log('');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

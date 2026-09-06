import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('changeme123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@tiptoptreesltd.com' },
    update: {},
    create: { name: 'Admin', email: 'admin@tiptoptreesltd.com', passwordHash, role: 'admin', status: 'active', hourlyRate: 0 },
  });

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tiptoptreesltd.com' } });

  // Per-user billing profile (idempotent — never duplicates).
  await prisma.companyProfile.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id },
  });

  // All optional features enabled for the seeded admin (idempotent).
  for (const feature of ['invoices', 'timesheet', 'clients_crm', 'quotes'] as const) {
    await prisma.userFeatureFlag.upsert({
      where: { userId_feature: { userId: admin.id, feature } },
      update: { enabled: true },
      create: { userId: admin.id, feature, enabled: true },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
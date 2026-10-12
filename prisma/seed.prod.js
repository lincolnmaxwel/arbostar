// Production-safe admin seed: plain JS (the runner image has no ts-node).
// Run inside the app container once, on a brand-new database:
//   node prisma/seed.prod.js
// Optional env: ADMIN_PASSWORD (defaults to "changeme123" - change it after
// the first login from /profile).
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const EMAIL = 'admin@tiptoptreesltd.com';

async function main() {
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'changeme123', 10);
  const admin = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { name: 'Admin', email: EMAIL, passwordHash, role: 'admin', status: 'active', hourlyRate: 0 },
  });
  await prisma.companyProfile.upsert({ where: { userId: admin.id }, update: {}, create: { userId: admin.id } });
  for (const feature of ['invoices', 'timesheet', 'clients_crm', 'quotes']) {
    await prisma.userFeatureFlag.upsert({
      where: { userId_feature: { userId: admin.id, feature } },
      update: { enabled: true },
      create: { userId: admin.id, feature, enabled: true },
    });
  }
  console.log('Seeded admin', EMAIL);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

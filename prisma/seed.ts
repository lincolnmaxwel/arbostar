import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('changeme123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@tiptoptreesltd.com' },
    update: {},
    create: { name: 'Admin', email: 'admin@tiptoptreesltd.com', passwordHash, role: 'admin' },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

import type { Prisma } from '@prisma/client';

// Invoice numbers are sequential per account (each user's first invoice is #1).
// Call inside a transaction: the advisory lock serialises concurrent creations
// for the same user so two requests never read the same "highest number".
export async function nextInvoiceNumber(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice-number:' + userId}))`;
  const last = await tx.invoice.aggregate({ where: { userId }, _max: { number: true } });
  return (last._max.number ?? 0) + 1;
}

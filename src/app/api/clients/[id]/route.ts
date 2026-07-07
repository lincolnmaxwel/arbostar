import { NextRequest, NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Quote.client now cascades (see schema.prisma), so deleting a Client
// deletes all their quotes too (and, transitively, QuoteItems/QuotePhotos/
// ScheduleRounds via those relations' own Cascade rules). Invoice.quote does
// NOT cascade, on purpose — if any of the client's quotes still has an
// invoice, the delete fails with a clear 409 instead of a raw foreign-key
// 500, so staff know to delete the invoice(s) first (DELETE
// /api/invoices/[id]) before the client.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const client = await prisma.client.findUnique({ where: { id: params.id }, include: { quotes: { select: { id: true } } } });
  if (!client) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    await prisma.client.delete({ where: { id: params.id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json({ error: 'has-invoice', message: 'Delete this client\'s invoice(s) first.' }, { status: 409 });
    }
    throw err;
  }

  for (const quote of client.quotes) {
    const dir = path.join(process.cwd(), 'uploads', 'quotes', quote.id);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Items (keyed by localItemId, matching DraftQuoteItem.id) and their photos
  // are included so QuoteView can show photos that were captured on a
  // DIFFERENT device — the client-side IndexedDB blob these photos were
  // captured into never syncs across devices (see photoSync.ts), only the
  // uploaded files on the server do. Without this, opening an already-synced
  // quote on a second device shows every item with zero photos.
  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { items: { include: { photos: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ quote });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quote = await prisma.quote.findUnique({ where: { id: params.id } });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // QuoteItem/QuotePhoto/ScheduleRound rows cascade via the schema's
  // onDelete: Cascade. Invoice does not — delete it explicitly first
  // (DELETE /api/invoices/[id]) or this fails with a 409.
  try {
    await prisma.quote.delete({ where: { id: params.id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json({ error: 'has-invoice', message: 'Delete this quote\'s invoice first.' }, { status: 409 });
    }
    throw err;
  }

  const dir = path.join(process.cwd(), 'uploads', 'quotes', params.id);
  await rm(dir, { recursive: true, force: true }).catch(() => {});

  return NextResponse.json({ ok: true });
}

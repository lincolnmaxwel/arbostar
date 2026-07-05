import { NextRequest, NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import path from 'path';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quote = await prisma.quote.findUnique({ where: { id: params.id } });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ quote });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quote = await prisma.quote.findUnique({ where: { id: params.id } });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // QuoteItem/QuotePhoto rows cascade via the schema's onDelete: Cascade.
  await prisma.quote.delete({ where: { id: params.id } });

  const dir = path.join(process.cwd(), 'public', 'uploads', 'quotes', params.id);
  await rm(dir, { recursive: true, force: true }).catch(() => {});

  return NextResponse.json({ ok: true });
}

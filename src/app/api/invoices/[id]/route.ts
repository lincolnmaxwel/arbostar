import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { quote: { include: { client: true, items: { orderBy: { sortOrder: 'asc' } } } } },
  });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ invoice });
}

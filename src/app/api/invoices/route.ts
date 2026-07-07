import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const invoices = await prisma.invoice.findMany({
    include: { quote: { include: { client: true } } },
    orderBy: { number: 'desc' },
  });

  return NextResponse.json({ invoices });
}

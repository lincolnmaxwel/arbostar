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

// Toggles payment tracking (Pending payment <-> Paid) — created Pending so
// staff can tell at a glance who's actually paid, flipped to Paid manually
// once payment is received (no payment gateway integration exists yet).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.paymentStatus !== 'paid' && body?.paymentStatus !== 'pending') {
    return NextResponse.json({ error: 'invalid paymentStatus' }, { status: 400 });
  }

  const invoice = await prisma.invoice.findUnique({ where: { id: params.id } });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updated = await prisma.invoice.update({
    where: { id: params.id },
    data: { paymentStatus: body.paymentStatus, paidAt: body.paymentStatus === 'paid' ? new Date() : null },
  });

  return NextResponse.json({ invoice: updated });
}

// Invoice.quote has no onDelete: Cascade (see schema.prisma) — deliberately,
// since an invoice is a record the client already received by email, not
// something that should vanish as a side effect of deleting its quote or
// client. Deleting it here is the explicit step that unblocks deleting the
// quote/client afterward.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const invoice = await prisma.invoice.findUnique({ where: { id: params.id } });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await prisma.invoice.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}

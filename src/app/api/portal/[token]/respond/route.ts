import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const respondSchema = z.object({ decision: z.enum(['approve', 'decline']) });

// No auth check here by design: the long, random publicToken IS the
// credential. Anyone with the link can respond to that one quote — the same
// model the reference Arbostar portal link uses.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const quote = await prisma.quote.findUnique({ where: { publicToken: params.token } });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (quote.status !== 'sent') {
    // Already responded (or not yet sent to begin with): return the current
    // status idempotently rather than erroring, so a double-click or a
    // refresh after responding doesn't surface a confusing failure.
    return NextResponse.json({ status: quote.status });
  }

  const status = parsed.data.decision === 'approve' ? 'approved' : 'declined';
  await prisma.quote.update({
    where: { id: quote.id },
    data: { status, respondedAt: new Date() },
  });

  return NextResponse.json({ status });
}

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { requireUserScope, auditScopedMutation, UnauthorizedError } from '@/lib/userScope';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const formData = await req.formData();
  const quoteItemId = formData.get('quoteItemId');
  const file = formData.get('file');
  if (typeof quoteItemId !== 'string' || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  // Scoped through the item's quote owner — an item on another user's quote
  // is as invisible as a nonexistent one.
  const item = await prisma.quoteItem.findFirst({
    where: { id: quoteItemId, quote: { createdById: scope.ownerUserId } },
  });
  if (!item) return NextResponse.json({ error: 'quote item not found' }, { status: 404 });

  // Written under a top-level uploads/ directory (not public/) and served via
  // /api/uploads/... — see that route for why: next start only scans public/
  // once at boot, so files written after startup (every real upload) would
  // 404 until the whole app restarts.
  const dir = path.join(process.cwd(), 'uploads', 'quotes', item.quoteId);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.jpg`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, fileName), buffer);

  const photo = await prisma.quotePhoto.create({
    data: { quoteItemId, filePath: `/api/uploads/quotes/${item.quoteId}/${fileName}`, sortOrder: 0 },
  });

  await auditScopedMutation(scope, 'QuotePhoto', photo.id, 'upload');

  return NextResponse.json({ photo }, { status: 201 });
}
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const quoteItemId = formData.get('quoteItemId');
  const file = formData.get('file');
  if (typeof quoteItemId !== 'string' || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const item = await prisma.quoteItem.findUnique({ where: { id: quoteItemId } });
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

  return NextResponse.json({ photo }, { status: 201 });
}

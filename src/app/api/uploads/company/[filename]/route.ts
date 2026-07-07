import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Same reasoning as /api/uploads/quotes/[quoteId]/[filename]: not served from
// public/ (next start only scans it once at boot, so an upload written after
// startup would 404 until a restart) and no auth check (the public
// client-approval portal must be able to show the company logo with no
// session).
export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  if (params.filename.includes('/') || params.filename.includes('..')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'uploads', 'company', params.filename);

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const ext = path.extname(params.filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  return new NextResponse(data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

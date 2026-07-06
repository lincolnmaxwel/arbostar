import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Uploaded photos are deliberately NOT served from Next's public/ directory:
// `next start` only scans public/ once at process boot, so any file written
// after the server starts (i.e. every real upload) 404s until the whole app
// is restarted. Serving them through a route handler means every request
// reads the current file from disk, no restart required.
//
// No auth check: the public client-approval portal must be able to display
// these same photos with no session, so this route has to stay reachable
// without login — same trust model the old public/uploads/ static path had.
export async function GET(_req: NextRequest, { params }: { params: { quoteId: string; filename: string } }) {
  if (
    params.quoteId.includes('/') ||
    params.quoteId.includes('..') ||
    params.filename.includes('/') ||
    params.filename.includes('..')
  ) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'uploads', 'quotes', params.quoteId, params.filename);

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

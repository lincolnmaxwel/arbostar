import { describe, it, expect, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { GET } from '@/app/api/uploads/quotes/[quoteId]/[filename]/route';

describe('GET /api/uploads/quotes/[quoteId]/[filename]', () => {
  const quoteId = randomUUID();
  const dir = path.join(process.cwd(), 'uploads', 'quotes', quoteId);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('serves a file written after the server started, with the right content type', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff]));

    const res = await GET(new Request('http://localhost/api/uploads/quotes/x/photo.jpg') as any, {
      params: { quoteId, filename: 'photo.jpg' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('returns 404 for a file that does not exist', async () => {
    const res = await GET(new Request('http://localhost/api/uploads/quotes/x/nope.jpg') as any, {
      params: { quoteId, filename: 'nope.jpg' },
    });
    expect(res.status).toBe(404);
  });

  it('rejects path traversal in quoteId or filename', async () => {
    const res1 = await GET(new Request('http://localhost/api/uploads/quotes/x/y') as any, {
      params: { quoteId: '..', filename: 'photo.jpg' },
    });
    expect(res1.status).toBe(400);

    const res2 = await GET(new Request('http://localhost/api/uploads/quotes/x/y') as any, {
      params: { quoteId, filename: '../../secrets.env' },
    });
    expect(res2.status).toBe(400);
  });
});

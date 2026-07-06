import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import path from 'path';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/quotes/photos/route';
import { prisma } from '@/lib/db';

describe('/api/quotes/photos', () => {
  let userId: string;
  let quoteId: string;
  let quoteItemId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Photo Test', email: `photo-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    const client = await prisma.client.create({ data: { name: 'Client', email: `client-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        items: { create: [{ localItemId: randomUUID(), title: 'Hedges', price: 100, sortOrder: 0 }] },
      },
      include: { items: true },
    });
    quoteId = quote.id;
    quoteItemId = quote.items[0].id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.quote.delete({ where: { id: quoteId } });
    await prisma.user.delete({ where: { id: userId } });
    const dir = path.join(process.cwd(), 'uploads', 'quotes', quoteId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('stores the uploaded file outside public/ and creates a QuotePhoto row pointing at the serving API route', async () => {
    const form = new FormData();
    form.set('quoteItemId', quoteItemId);
    form.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'photo.jpg');
    const req = new Request('http://localhost/api/quotes/photos', { method: 'POST', body: form });

    const res = await POST(req as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.photo.filePath).toMatch(new RegExp(`^/api/uploads/quotes/${quoteId}/`));

    // Written under uploads/ (project root), not public/uploads/ — files under
    // public/ are only picked up by `next start` at boot, so a real upload
    // written after the server is already running would 404 forever.
    const fileName = body.photo.filePath.split('/').pop();
    const filePath = path.join(process.cwd(), 'uploads', 'quotes', quoteId, fileName);
    expect(existsSync(filePath)).toBe(true);
  });
});

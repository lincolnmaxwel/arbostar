// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const heic2anyMock = vi.fn(async ({ blob }: { blob: Blob }) => new Blob([blob, 'converted'], { type: 'image/jpeg' }));
vi.mock('heic2any', () => ({ default: (...args: unknown[]) => heic2anyMock(...(args as [{ blob: Blob }])) }));

// jsdom implements neither createImageBitmap nor canvas 2d drawing/encoding —
// stub just enough of the pipeline to observe which Blob compressImage
// actually hands to createImageBitmap (the original file, or heic2any's
// converted output).
let lastBitmapSource: Blob | null = null;
global.createImageBitmap = vi.fn(async (source: ImageBitmapSource) => {
  lastBitmapSource = source as Blob;
  return { width: 100, height: 100, close: () => {} } as unknown as ImageBitmap;
}) as unknown as typeof createImageBitmap;

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toBlob = vi.fn(function toBlob(this: HTMLCanvasElement, cb: BlobCallback) {
  cb(new Blob(['compressed'], { type: 'image/jpeg' }));
});

import { compressImage } from '@/lib/compressImage';

describe('compressImage', () => {
  beforeEach(() => {
    heic2anyMock.mockClear();
    lastBitmapSource = null;
  });

  it('converts a HEIC file (by mime type) through heic2any before decoding', async () => {
    const heicFile = new File(['fake-heic-bytes'], 'IMG_0001.HEIC', { type: 'image/heic' });
    await compressImage(heicFile);

    expect(heic2anyMock).toHaveBeenCalledTimes(1);
    expect(lastBitmapSource).not.toBe(heicFile);
  });

  it('converts a HEIC file identified only by filename extension (empty/generic mime type)', async () => {
    const heicFile = new File(['fake-heic-bytes'], 'IMG_0002.heic', { type: 'application/octet-stream' });
    await compressImage(heicFile);

    expect(heic2anyMock).toHaveBeenCalledTimes(1);
  });

  it('skips heic2any entirely for a normal JPEG', async () => {
    const jpegFile = new File(['fake-jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await compressImage(jpegFile);

    expect(heic2anyMock).not.toHaveBeenCalled();
    expect(lastBitmapSource).toBe(jpegFile);
  });
});

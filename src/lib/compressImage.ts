const HEIC_TYPES = ['image/heic', 'image/heif'];

function looksLikeHeic(file: Blob & { name?: string }): boolean {
  if (HEIC_TYPES.includes(file.type)) return true;
  // iOS Safari sometimes hands us a HEIC file with an empty/generic type
  // (application/octet-stream) depending on how it was shared — fall back to
  // the filename extension, which iOS still sets correctly either way.
  const name = file.name ?? '';
  return /\.heic$|\.heif$/i.test(name);
}

// iPhones capture photos as HEIC/HEIF by default, which createImageBitmap
// can't decode in any browser except Safari (no other engine ships an HEIC
// codec) — attaching one from a synced photo library on Android/Windows/
// Chrome/Firefox would otherwise throw inside createImageBitmap below and
// silently drop the photo. heic2any ships a WASM HEIC decoder so this works
// everywhere, not just on the device that took the photo.
async function toDecodableBlob(file: Blob & { name?: string }): Promise<Blob> {
  if (!looksLikeHeic(file)) return file;
  const heic2any = (await import('heic2any')).default;
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(converted) ? converted[0] : converted;
}

export async function compressImage(file: Blob, maxDimension = 1600, quality = 0.8): Promise<Blob> {
  const decodable = await toDecodableBlob(file);
  const bitmap = await createImageBitmap(decodable);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('compression failed'))), 'image/jpeg', quality);
  });
}

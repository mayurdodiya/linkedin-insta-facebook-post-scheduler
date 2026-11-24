/**
 * Serverless hosts (Vercel) reject request bodies over ~4.5 MB with "413 Request Entity Too Large",
 * and phone photos are often 3-8 MB each. Downscale large JPEG/PNG photos in the browser right
 * before upload. Small files, GIFs and videos are returned untouched; any failure falls back to
 * the original file so uploading never gets worse than before.
 */
const SKIP_BELOW = 700 * 1024;
const TARGET = 900 * 1024;

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function shrinkImage(file: File): Promise<File> {
  if ((file.type !== 'image/jpeg' && file.type !== 'image/png') || file.size <= SKIP_BELOW) return file;
  try {
    const bitmap = await createImageBitmap(file);
    let best: Blob | null = null;
    for (const [maxSide, quality] of [
      [2048, 0.85],
      [1600, 0.78],
      [1280, 0.7],
    ] as const) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.fillStyle = '#fff'; // JPEG has no transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      best = await toBlob(canvas, quality);
      if (best && best.size <= TARGET) break;
    }
    bitmap.close();
    if (!best || best.size >= file.size) return file;
    return new File([best], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

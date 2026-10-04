'use client';

interface CompressOptions {
  /** Longest side, in pixels, after shrinking. */
  maxSide: number;
  /** JPEG quality, 0 to 1. */
  quality: number;
  /** Files smaller than this are left alone. */
  minBytes?: number;
}

/**
 * Shrinks a photo in the browser before it is uploaded. A phone camera makes
 * 3 to 8 MB files that are slow on a weak connection and can exceed the 5 MB
 * limit; at 1920 px a page of handwriting is still easy to read and is a few
 * hundred KB. Anything that goes wrong (an unsupported format, no canvas)
 * returns the original file untouched, so this can only help.
 */
export async function compressImage(file: File, options: CompressOptions): Promise<File> {
  const { maxSide, quality, minBytes = 400_000 } = options;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < minBytes) return file;

  try {
    // 'from-image' applies the camera's rotation so the upload is the right way up.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    // JPEG has no transparency: a transparent PNG would turn black without this.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

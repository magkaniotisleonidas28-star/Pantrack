import { MAX_PHOTO_BYTES } from './waste-suggestion-contract';

/** Longest side sent for reading; enough to count pastries on a tray. */
export const PHOTO_MAX_SIDE = 1568;

/**
 * Resizes a photo in the browser and re-saves it as JPEG. Redrawing on a canvas
 * keeps only the pixels, so hidden details such as location are not sent.
 */
export async function preparePhoto(
  file: Blob,
): Promise<{ mediaType: 'image/jpeg'; data: string; bytes: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo could not be opened. Take a new photo or choose a JPEG.');
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare photos.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (blob && blob.size <= MAX_PHOTO_BYTES) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { mediaType: 'image/jpeg', data: btoa(binary), bytes: bytes.length };
    }
  }
  throw new Error('This photo is too large to send. Take it again a little further away.');
}

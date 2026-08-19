/**
 * Decoding an image file to pixels — the only part of the board reader that
 * touches native code.
 *
 * Kept as thin as possible: decode, hand back a plain buffer, and let the pure
 * pipeline in pixelBuffer.ts and readFrame.ts do everything interesting. That
 * boundary is what keeps the reader unit-testable.
 *
 * WHY SKIA
 * --------
 * expo-image-manipulator can crop and resize but cannot read pixels, and
 * expo-gl would mean a shader for what is fundamentally an array copy. Skia
 * decodes and exposes the buffer directly.
 */

import { Skia } from '@shopify/react-native-skia';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';

export type { PixelBuffer } from '@/services/vision/pixelBuffer';
export { downscale, readPixel, cropGray } from '@/services/vision/pixelBuffer';

/**
 * Decode a local image file into a pixel buffer.
 *
 * `uri` is a file:// path — what expo-camera and expo-image-picker hand back.
 * Returns null rather than throwing, because a failed decode should degrade to
 * manual entry rather than crash a game setup.
 */
export async function loadPixelBuffer(uri: string): Promise<PixelBuffer | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return null;

    const width = image.width();
    const height = image.height();
    const pixels = image.readPixels();
    if (!pixels) return null;

    return { data: new Uint8Array(pixels.buffer ?? pixels), width, height };
  } catch {
    return null;
  }
}

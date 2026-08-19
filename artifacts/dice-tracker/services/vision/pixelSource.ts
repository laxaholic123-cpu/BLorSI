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
export { downscale, readPixel, cropGray, screenToImage } from '@/services/vision/pixelBuffer';

/**
 * Decode a local image file into a pixel buffer.
 *
 * `uri` is a file:// path — what expo-camera and expo-image-picker hand back.
 * Returns null rather than throwing, because a failed decode should degrade to
 * manual entry rather than crash a game setup.
 */
export async function loadPixelBuffer(uri: string): Promise<PixelBuffer | null> {
  try {
    const encoded = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(encoded);
    if (!image) return null;

    const width = image.width();
    const height = image.height();
    const pixels = image.readPixels();
    if (!pixels) return null;

    // readPixels returns Float32Array OR Uint8Array depending on the image's
    // colour type. Treating a Float32Array as bytes reinterprets its raw float
    // bytes and produces pure noise — an especially nasty failure, because
    // nothing throws and the board simply reads as nonsense.
    const expected = width * height * 4;
    let bytes: Uint8Array;
    if (pixels instanceof Uint8Array) {
      if (pixels.length < expected) return null;
      bytes = pixels;
    } else {
      if (pixels.length < expected) return null;
      // Float pixels are 0..1; bring them into byte range.
      bytes = new Uint8Array(expected);
      for (let i = 0; i < expected; i++) {
        bytes[i] = Math.max(0, Math.min(255, Math.round(pixels[i]! * 255)));
      }
    }

    return { data: bytes, width, height };
  } catch {
    return null;
  }
}

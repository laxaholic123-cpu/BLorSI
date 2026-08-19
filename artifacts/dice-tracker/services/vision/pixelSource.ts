/**
 * Pixel access — the only part of the board reader that touches native code.
 *
 * Everything else in services/vision is pure and unit-tested. This module is
 * deliberately thin: it decodes an image to a flat RGBA buffer and hands it to
 * the pure pipeline, so the interesting logic never becomes untestable.
 *
 * WHY SKIA
 * --------
 * expo-image-manipulator can crop and resize but cannot read pixels, and
 * expo-gl would mean a shader for what is fundamentally an array copy. Skia
 * decodes and exposes the buffer directly. It is a native module, which is why
 * adding it required a new development build.
 */

import { Skia } from '@shopify/react-native-skia';

/** A decoded image as a flat RGBA byte buffer. */
export interface PixelBuffer {
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Decode a local image file into a pixel buffer.
 *
 * `uri` is a file:// path — what expo-image-picker hands back. Returns null
 * rather than throwing, because a failed decode should degrade to manual entry
 * rather than crash a game setup.
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

/**
 * Downscale a buffer by an integer factor using box averaging.
 *
 * A modern phone photo is around 3000x4000 — twelve million pixels, of which the
 * reader needs a few thousand. Averaging blocks rather than dropping pixels also
 * suppresses sensor noise and JPEG artefacts before any classification happens,
 * which is free denoising.
 */
export function downscale(buffer: PixelBuffer, factor: number): PixelBuffer {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return buffer;

  const width = Math.floor(buffer.width / f);
  const height = Math.floor(buffer.height / f);
  const out = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        const srcRow = (y * f + dy) * buffer.width;
        for (let dx = 0; dx < f; dx++) {
          const i = (srcRow + x * f + dx) * 4;
          r += buffer.data[i]!;
          g += buffer.data[i + 1]!;
          b += buffer.data[i + 2]!;
          a += buffer.data[i + 3]!;
        }
      }
      const n = f * f;
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }

  return { data: out, width, height };
}

/**
 * Read one pixel, with bounds clamping.
 *
 * Clamps rather than returning null because sample points are derived from a
 * homography the player supplied by tapping — a slightly generous tap can put a
 * sample a pixel or two outside the image, and refusing to read it would throw
 * away an otherwise good tile.
 */
export function readPixel(
  buffer: PixelBuffer,
  x: number,
  y: number,
): { r: number; g: number; b: number } {
  const px = Math.min(buffer.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(buffer.height - 1, Math.max(0, Math.round(y)));
  const i = (py * buffer.width + px) * 4;
  return { r: buffer.data[i]!, g: buffer.data[i + 1]!, b: buffer.data[i + 2]! };
}

/** Grayscale luminance of a region, for thresholding a token crop. */
export function cropGray(
  buffer: PixelBuffer,
  left: number,
  top: number,
  width: number,
  height: number,
): { data: Uint8Array; width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { r, g, b } = readPixel(buffer, left + x, top + y);
      // Rec. 709 luma — matches how the eye weights the channels.
      out[y * w + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }
  return { data: out, width: w, height: h };
}

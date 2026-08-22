/**
 * The native half of OCR token reading.
 *
 * Impure by necessity, and isolated for the same reason `pixelSource.ts` is
 * kept apart from `pixelBuffer.ts`: anything importing a native module cannot
 * be tested, so the geometry lives next door in `ocrTokens.ts` where it can be.
 *
 * expo-mlkit-ocr is LAZILY required. It is a native module, so a development
 * build made before it was added does not contain it — and importing it at
 * module scope would take the whole capture screen down on the build currently
 * on the phone. Absent module means absent OCR, and the reader falls back to
 * counting pips exactly as before.
 */

import { Image } from 'react-native';

import type { OcrText } from '@/services/vision/ocrTokens';

export interface OcrOutcome {
  /** Recognised text, positioned in normalised image space. */
  texts: OcrText[];
  /** False when the module is missing or the platform has no recogniser. */
  available: boolean;
  /** Why nothing came back, for the diagnostics export. */
  reason?: string;
  /**
   * Everything the recogniser returned, verbatim and unfiltered.
   *
   * Without this "no numbers recognised" is unactionable: it cannot separate
   * "the recogniser found nothing" from "it found plenty and the parser threw
   * it all away", and those need opposite fixes. The raw strings go into the
   * diagnostic export so one capture answers the question.
   */
  rawTexts?: string[];
  /** Size the boxes were measured against, to check the normalisation. */
  imageSize?: { width: number; height: number };
}

const UNAVAILABLE = (reason: string): OcrOutcome => ({ texts: [], available: false, reason });

type MlkitModule = {
  recognizeText: (uri: string) => Promise<{
    blocks: Array<{
      lines: Array<{
        text?: string;
        elements: Array<{
          text: string;
          // Nullable on the native side, so never dereferenced blind.
          boundingBox?: { x: number; y: number; width: number; height: number } | null;
        }>;
      }>;
    }>;
  }>;
  isSupported: () => boolean;
};

function loadModule(): MlkitModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-mlkit-ocr') as MlkitModule;
  } catch {
    return null;
  }
}

/**
 * Measure the image the recogniser will read, so its boxes can be normalised.
 *
 * The bounding boxes come back in the pixel space of the file at `uri`, which
 * is the full photo — not the downscaled buffer the reader works on. Without
 * the file's own dimensions every box would be offset by whatever the
 * downscale factor happened to be.
 *
 * `bufferAspect` is a cross-check, not a formality. Android reports image size
 * before or after EXIF rotation depending on the path, and a swapped width and
 * height would place every recognised number on the wrong tile while looking
 * entirely reasonable.
 */
async function measure(
  uri: string,
  bufferAspect: number,
): Promise<{ width: number; height: number } | null> {
  const size = await new Promise<{ width: number; height: number } | null>(resolve => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null));
  });
  if (!size || size.width <= 0 || size.height <= 0) return null;

  const asIs = Math.abs(size.width / size.height - bufferAspect);
  const swapped = Math.abs(size.height / size.width - bufferAspect);
  return swapped < asIs ? { width: size.height, height: size.width } : size;
}

/**
 * Read every number the recogniser can find in the photo.
 *
 * One call on the whole image rather than nineteen on cropped tokens. Cropping
 * would mean writing files, and expo-file-system is not installed — but the
 * whole-image route is better regardless: one native call, and the recogniser
 * gets the context that helps it separate digits from the board's other
 * printing.
 */
export async function recognizeBoardText(
  uri: string,
  bufferAspect: number,
): Promise<OcrOutcome> {
  const mlkit = loadModule();
  if (!mlkit) {
    return UNAVAILABLE('OCR module not in this build — rebuild to enable it.');
  }
  try {
    if (!mlkit.isSupported()) return UNAVAILABLE('No text recogniser on this device.');
  } catch {
    return UNAVAILABLE('Text recogniser unavailable.');
  }

  const size = await measure(uri, bufferAspect);
  if (!size) return UNAVAILABLE('Could not measure the photo.');

  try {
    const result = await mlkit.recognizeText(uri);
    const texts: OcrText[] = [];
    /** Recognised but not positionable — still evidence about what was seen. */
    const unplaced: string[] = [];
    for (const block of result.blocks ?? []) {
      for (const line of block.lines ?? []) {
        // Elements, not lines: a line can sweep up two tokens that happen to
        // sit level with each other, and its box would then centre on the gap
        // between them.
        const elements = line.elements ?? [];
        if (elements.length === 0 && line.text) {
          // Some recognisers fill only the line. Better a whole line placed
          // roughly than a token dropped silently.
          unplaced.push(line.text);
        }
        for (const element of elements) {
          const b = element.boundingBox;
          if (!b) {
            // The box is nullable natively. Keep the text for the diagnostic
            // even though it cannot be positioned.
            unplaced.push(element.text);
            continue;
          }
          texts.push({
            text: element.text,
            cx: (b.x + b.width / 2) / size.width,
            cy: (b.y + b.height / 2) / size.height,
          });
        }
      }
    }
    return {
      texts,
      available: true,
      // Capped: a board can produce a lot of fragments and this rides in a
      // share sheet.
      rawTexts: [...texts.map(t => t.text), ...unplaced.map(t => `(unplaced) ${t}`)]
        .slice(0, 60),
      imageSize: size,
    };
  } catch {
    return UNAVAILABLE('Text recognition failed on this photo.');
  }
}

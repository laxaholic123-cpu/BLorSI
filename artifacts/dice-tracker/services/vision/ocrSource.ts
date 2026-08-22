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
import { mergeRotatedTexts, unrotatePoint } from '@/services/vision/ocrTokens';

/** Quarter turns to read at. 0 first, so it wins ties when passes are merged. */
const ROTATIONS = [0, 90, 180, 270] as const;

/** Margin around the board when cropping, in fractions of its bounding box. */
const CROP_MARGIN = 0.04;

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
async function measureRaw(uri: string): Promise<{ width: number; height: number } | null> {
  const size = await new Promise<{ width: number; height: number } | null>(resolve => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null));
  });
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}

async function measure(
  uri: string,
  bufferAspect: number,
): Promise<{ width: number; height: number } | null> {
  const size = await measureRaw(uri);
  if (!size) return null;

  const asIs = Math.abs(size.width / size.height - bufferAspect);
  const swapped = Math.abs(size.height / size.width - bufferAspect);
  return swapped < asIs ? { width: size.height, height: size.width } : size;
}

/** expo-image-manipulator, lazily required for the same reason as ML Kit. */
type Manipulator = {
  manipulateAsync: (
    uri: string,
    actions: Array<Record<string, unknown>>,
    options?: { compress?: number; format?: unknown },
  ) => Promise<{ uri: string; width: number; height: number }>;
  SaveFormat: { JPEG: unknown };
};

function loadManipulator(): Manipulator | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-image-manipulator') as Manipulator;
  } catch {
    return null;
  }
}

/** The board's bounding box in the photo, with a little margin, in 0-1 space. */
function boardRect(corners: readonly { x: number; y: number }[]) {
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  // The marked corners are hex CENTRES, so the board extends beyond them by
  // roughly one hex. The margin has to clear that or the outer ring is cropped
  // away along with the furniture.
  const padX = (maxX - minX) * 0.34 + CROP_MARGIN;
  const padY = (maxY - minY) * 0.26 + CROP_MARGIN;
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  return {
    x,
    y,
    width: Math.min(1 - x, maxX - minX + padX * 2),
    height: Math.min(1 - y, maxY - minY + padY * 2),
  };
}

/**
 * Read the board, cropped and at four rotations.
 *
 * Two findings drive this, both measured on a capture where ML Kit returned
 * exactly four items from a photo containing eighteen printed numbers:
 *
 *     saw 4: 9 10 ESPARCEL SELECT
 *
 * **It reads the room.** "ESPARCEL SELECT" is a parcel label on the table. The
 * board is a fraction of the frame, so most of what the recogniser attends to
 * is furniture. Hence the crop, built from the corners the player already marks.
 *
 * **It only reads upright text.** The two digits it did find — 9 and 10 — were
 * on upright tokens; every upside-down one was missed. Catan tokens sit at
 * every rotation, which is precisely the property `tokenDecode.ts` was designed
 * to sidestep and OCR discards. So the crop is read four times, a quarter-turn
 * apart, and the passes are merged.
 *
 * Degrades rather than breaks: without the manipulator it falls back to the
 * single whole-photo pass that was there before.
 */
export async function recognizeBoardText(
  uri: string,
  bufferAspect: number,
  corners?: readonly { x: number; y: number }[],
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

  const manipulator = loadManipulator();
  const rect = corners && corners.length === 4 ? boardRect(corners) : null;

  const passes: OcrText[][] = [];
  const raw: string[] = [];

  for (const degrees of ROTATIONS) {
    // Nothing to rotate with means only the plain pass is possible.
    if (degrees !== 0 && !manipulator) break;

    let readUri = uri;
    if (manipulator) {
      try {
        const actions: Array<Record<string, unknown>> = [];
        if (rect) {
          actions.push({
            crop: {
              originX: Math.round(rect.x * size.width),
              originY: Math.round(rect.y * size.height),
              width: Math.round(rect.width * size.width),
              height: Math.round(rect.height * size.height),
            },
          });
        }
        if (degrees !== 0) actions.push({ rotate: degrees });
        if (actions.length > 0) {
          const out = await manipulator.manipulateAsync(uri, actions, { compress: 1 });
          readUri = out.uri;
        }
      } catch {
        continue; // one failed preparation must not lose the other passes
      }
    }

    try {
      const result = await mlkit.recognizeText(readUri);
      const pass: OcrText[] = [];
      for (const block of result.blocks ?? []) {
        for (const line of block.lines ?? []) {
          for (const element of line.elements ?? []) {
            const b = element.boundingBox;
            if (!b) continue;
            raw.push(`${degrees}° ${element.text}`);
            pass.push({ text: element.text, cx: b.x + b.width / 2, cy: b.y + b.height / 2 });
          }
        }
      }
      passes.push(await toOriginalSpace(pass, readUri, degrees, rect));
    } catch {
      continue;
    }
  }

  if (passes.length === 0) return UNAVAILABLE('Text recognition failed on this photo.');

  const texts = mergeRotatedTexts(passes);
  return { texts, available: true, rawTexts: raw.slice(0, 60), imageSize: size };
}

/**
 * Bring one pass's boxes back to the original photo's normalised space.
 *
 * Three stages, and every one of them has to be undone in order or numbers land
 * on the wrong tiles while looking entirely reasonable:
 *
 *   1. pixels in the image that was read  ->  0-1 within that image
 *   2. undo the rotation                  ->  0-1 within the crop
 *   3. undo the crop                      ->  0-1 within the original photo
 */
async function toOriginalSpace(
  pass: readonly OcrText[],
  readUri: string,
  degrees: (typeof ROTATIONS)[number],
  rect: { x: number; y: number; width: number; height: number } | null,
): Promise<OcrText[]> {
  if (pass.length === 0) return [];

  // Measured rather than derived: the manipulator may adjust dimensions, and
  // guessing them would offset every box.
  // measureRaw, not measure: the aspect-swap guard exists for the original
  // photo's EXIF ambiguity, and a quarter-turned crop legitimately has the
  // other aspect. Applying the guard here would transpose every box.
  const read = await measureRaw(readUri).catch(() => null);
  const readW = read?.width ?? 1;
  const readH = read?.height ?? 1;
  if (readW <= 1 || readH <= 1) return [];

  return pass.map(item => {
    const inRead = { cx: item.cx / readW, cy: item.cy / readH };
    const inCrop = unrotatePoint(inRead.cx, inRead.cy, degrees);
    if (!rect) return { text: item.text, cx: inCrop.cx, cy: inCrop.cy };
    return {
      text: item.text,
      cx: rect.x + inCrop.cx * rect.width,
      cy: rect.y + inCrop.cy * rect.height,
    };
  });
}

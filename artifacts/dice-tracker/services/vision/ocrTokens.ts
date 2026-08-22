/**
 * Turn recognised text into number tokens, one per hex.
 *
 * WHY OCR AT ALL, given `tokenDecode.ts` deliberately avoids it
 * ------------------------------------------------------------
 * Counting pips, glyphs and holes is rotation-invariant, which OCR is not, and
 * that was a good reason to prefer it. But it needs the small features to
 * survive thresholding, and measured on real captures they do not. With the
 * token face correctly located, at full resolution, on a clean overhead shot,
 * blob counting reads 9 of 18. Filtering speckle out of the hole count changes
 * nothing. That is roughly its ceiling, and it is not enough to be useful.
 *
 * The tokens are printed digits from a closed set of ten. Reading them as
 * digits is the obvious thing, and the two approaches complement each other
 * rather than compete:
 *
 *   - OCR cannot tell a rotated 6 from a 9. The RED INK signal can: 6 and 8 are
 *     the only red tokens, so a red 6/9 is a 6 and a black one is a 9.
 *   - OCR reads each token independently. The token bag does not: exactly one
 *     2, one 12, two of everything else. `boardConstraints` already enforces
 *     that, and can repair a stray read.
 *
 * This module is PURE — it takes boxes that someone else obtained and does the
 * geometry. The native call lives in `ocrSource.ts`, keeping the rule that
 * tests import no React Native.
 */

import { HEX_CENTERS, CORNER_HEX_CENTERS } from '@/services/vision/boardGeometry';
import { solveHomography, applyHomography, type Point } from '@/services/vision/homography';

/** Every value a Catan number token can carry. 7 is absent: it has no token. */
export const VALID_TOKENS: readonly number[] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

/**
 * A piece of recognised text, positioned in NORMALISED image space (0-1).
 *
 * Normalised rather than pixels so the caller can hand over results from an
 * image of any size — and so a mismatch between what the recogniser measured
 * and what the reader decoded cannot silently offset everything.
 */
export interface OcrText {
  text: string;
  /** Centre of the recognised box, 0-1 on each axis. */
  cx: number;
  cy: number;
}

export interface OcrTokenReading {
  hexIndex: number;
  value: number;
  /** Distance from the hex centre, in canonical hex-radii. Smaller is safer. */
  distance: number;
}

/**
 * Parse recognised text into a token value.
 *
 * Deliberately strict. A recogniser looking at a board finds all sorts of
 * things — harbour ratios like "2:1" and "3:1", pip rows, edition text on the
 * frame — and any of them could be coerced into a plausible number if the
 * parsing were generous. Only a bare number that is actually in the deck counts.
 */
export function parseTokenText(raw: string): number | null {
  const trimmed = raw.trim();
  // Anything with a separator is a trade ratio or worse, not a token.
  if (/[^0-9]/.test(trimmed)) return null;
  if (trimmed.length === 0 || trimmed.length > 2) return null;
  const value = Number(trimmed);
  return VALID_TOKENS.includes(value) ? value : null;
}

/**
 * Largest distance, in canonical hex-radii, that still counts as "on this hex".
 *
 * A token sits at the hex centre and the hexes are 1 radius apart at their
 * closest, so anything beyond half a radius is more likely to belong to the
 * neighbour. Being unassigned is better than being assigned to the wrong tile:
 * a missing number is visible and correctable, a wrong one is neither.
 */
const MAX_SNAP_DISTANCE = 0.5;

/**
 * Assign recognised numbers to hexes.
 *
 * `corners` are the four corner-hex centres in normalised image space, in the
 * same TL TR BR BL order the capture screen uses — so exactly what the player
 * marked. The homography that maps canonical board space onto the photo is
 * inverted here to bring text boxes back the other way.
 *
 * When two readings land on one hex the closer wins, which is what happens
 * when a recogniser splits "10" into "1" and "0" and one fragment drifts.
 */
export function mapOcrToHexes(
  texts: readonly OcrText[],
  corners: readonly [Point, Point, Point, Point],
): OcrTokenReading[] {
  // Canonical -> image is what the reader uses; invert it by solving the other
  // way round rather than inverting the matrix, which is both simpler and
  // avoids a near-singular inverse when the corners are nearly degenerate.
  const imageToCanonical = solveHomography(
    corners,
    CORNER_HEX_CENTERS as unknown as readonly [Point, Point, Point, Point],
  );
  if (!imageToCanonical) return [];

  const best = new Map<number, OcrTokenReading>();

  for (const item of texts) {
    const value = parseTokenText(item.text);
    if (value === null) continue;

    const canonical = applyHomography(imageToCanonical, { x: item.cx, y: item.cy });
    if (!canonical) continue;

    let nearest = -1;
    let nearestDistance = Infinity;
    HEX_CENTERS.forEach((centre, index) => {
      const d = Math.hypot(canonical.x - centre.x, canonical.y - centre.y);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = index;
      }
    });

    if (nearest < 0 || nearestDistance > MAX_SNAP_DISTANCE) continue;

    const existing = best.get(nearest);
    if (!existing || nearestDistance < existing.distance) {
      best.set(nearest, { hexIndex: nearest, value, distance: nearestDistance });
    }
  }

  return [...best.values()].sort((a, b) => a.hexIndex - b.hexIndex);
}

/**
 * Undo a quarter-turn, bringing a point in a rotated image back to the original.
 *
 * ML Kit reads text that is roughly upright and little else. Measured on a real
 * board it found four items in the whole photo — two token digits, both on
 * UPRIGHT tokens, plus a parcel label in the background. Every upside-down
 * token was missed, and Catan tokens sit at every rotation, which is exactly
 * the property `tokenDecode.ts` was built to sidestep and OCR throws away.
 *
 * So the photo is read four times, a quarter-turn apart, and each pass is
 * mapped back here. All coordinates are normalised 0-1, so a quarter turn also
 * swaps the axes.
 *
 * `degrees` is how far the IMAGE was rotated clockwise before reading.
 */
export function unrotatePoint(
  cx: number,
  cy: number,
  degrees: 0 | 90 | 180 | 270,
): { cx: number; cy: number } {
  switch (degrees) {
    case 0:
      return { cx, cy };
    // The image turned clockwise, so a point turns back anticlockwise.
    case 90:
      return { cx: cy, cy: 1 - cx };
    case 180:
      return { cx: 1 - cx, cy: 1 - cy };
    case 270:
      return { cx: 1 - cy, cy: cx };
  }
}

/**
 * Merge readings from several rotations into one set.
 *
 * A token found upright in more than one pass is the same token, so the
 * duplicates have to collapse — otherwise four passes report four boards. Two
 * readings within `tolerance` of each other are treated as the same find; the
 * first wins, since passes are ordered with the untransformed one first and
 * that is the least likely to have been displaced by a rounding error.
 */
export function mergeRotatedTexts(
  passes: readonly (readonly OcrText[])[],
  tolerance = 0.02,
): OcrText[] {
  const kept: OcrText[] = [];
  for (const pass of passes) {
    for (const item of pass) {
      const duplicate = kept.some(
        k => Math.hypot(k.cx - item.cx, k.cy - item.cy) <= tolerance,
      );
      if (!duplicate) kept.push(item);
    }
  }
  return kept;
}

/**
 * Resolve the one ambiguity rotation leaves behind.
 *
 * A 6 upside down is a 9, and no amount of reading the glyph settles it. Ink
 * colour does, completely: 6 and 8 are printed red and nothing else is. So a
 * red 6-or-9 is a 6, and a black one is a 9.
 *
 * `isRed` is undefined when there was too little ink to judge, and an absent
 * signal must leave the reading alone rather than guess — which is why this
 * takes a tri-state rather than a boolean.
 */
export function disambiguateWithInk(
  value: number,
  isRed: boolean | undefined,
): number {
  if (isRed === undefined) return value;
  if (value === 6 && !isRed) return 9;
  if (value === 9 && isRed) return 6;
  return value;
}

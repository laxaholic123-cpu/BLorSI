/**
 * Recognise a number token by matching its DIGIT against examples of itself.
 *
 * WHY MATCHING, AFTER COUNTING AND OCR BOTH FAILED
 * ------------------------------------------------
 * Counting pips, glyphs and holes tops out around half the tokens — measured
 * repeatedly, and it stayed there even after the face location that was feeding
 * it was fixed. OCR does worse: on real captures ML Kit read harbour labels and
 * a parcel label off the table, and one token in seventeen. It reads
 * text-SHAPED things, and a serif digit on a cream circle is not one.
 *
 * But general reading was never the problem. The token is already located,
 * there are exactly ten possible answers, and every one is printed identically
 * on the same board under the same lamp. That is recognising which of ten known
 * things this is — a matching problem, which needs no detector, and the
 * detector is the part that kept failing.
 *
 * THE REPRESENTATION
 * ------------------
 * **Polar sampling** turns rotation into a cyclic SHIFT along the angle axis,
 * so matching every orientation is a shift search rather than 64 image
 * rotations. That recovers the rotation invariance which made the original
 * pip-counting design right in the first place, without needing the pips.
 *
 * **Centred and scaled on the DIGIT, not the face**, so print size, camera
 * distance and where the token happened to sit all drop out. Sampling the whole
 * face instead is what made an earlier attempt score at chance: a crescent of
 * tile inside the sampled disc swamped the numeral.
 *
 * **Packed to bits.** 12 rings x 64 sectors is 768 cells = 24 uint32 words, so
 * comparing two shapes is 24 XOR-and-popcounts instead of 768 comparisons. 64
 * sectors is exactly two words per ring, which also makes rotation a 64-bit
 * rotate of each ring rather than a per-cell copy. Together those are what keep
 * 111 templates x 64 rotations x 18 tokens affordable on a phone.
 *
 * Pure. Sampling pixels lives in `digitSample.ts`, the examples in
 * `tokenLibrary.ts`.
 */

/** Rings sampled outward from the digit's centre of mass. */
export const DIGIT_RINGS = 12;

/**
 * Samples around each ring: the rotation resolution, 360/64 = 5.6 degrees.
 *
 * Also exactly two uint32 per ring, which the packing and rotation rely on.
 * Changing it means changing both.
 */
export const DIGIT_SECTORS = 64;

export const DIGIT_CELLS = DIGIT_RINGS * DIGIT_SECTORS;
export const DIGIT_WORDS = DIGIT_CELLS / 32;

/** A digit reduced to ink-or-not on a polar grid, packed two words per ring. */
export interface DigitTemplate {
  value: number;
  bits: Uint32Array;
}

export interface DigitMatch {
  value: number;
  /** Agreement with the best template, 0-1. */
  score: number;
  /**
   * How far ahead the winner is of the best DIFFERENT value, 0-1.
   *
   * DIAGNOSTIC ONLY. Do NOT gate on this — see `isTrustworthy`.
   */
  margin: number;
  /** Sectors of rotation at the best alignment. */
  shift: number;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode base64 without depending on `atob`.
 *
 * Hermes has gained and lost globals across React Native versions, and a
 * template library that silently fails to load would present as "recognition
 * got worse" rather than as an error. Fifteen lines removes the question.
 */
function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let acc = 0;
  let written = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = BASE64_ALPHABET.indexOf(clean[i]!);
    if (value < 0) continue;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/** Unpack a base64 template into words. Big-endian, matching the generator. */
export function unpackShape(packed: string): Uint32Array {
  const bytes = decodeBase64(packed);
  const words = new Uint32Array(DIGIT_WORDS);
  for (let w = 0; w < DIGIT_WORDS; w++) {
    const o = w * 4;
    if (o + 3 >= bytes.length) break;
    words[w] =
      (((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0);
  }
  return words;
}

/** Pack a freshly sampled shape. Inverse of `unpackShape`'s bit order. */
export function packShape(cells: readonly boolean[]): Uint32Array {
  const words = new Uint32Array(DIGIT_WORDS);
  for (let i = 0; i < DIGIT_CELLS && i < cells.length; i++) {
    if (cells[i]) {
      const w = i >>> 5;
      words[w] = (words[w]! | (0x80000000 >>> (i & 31))) >>> 0;
    }
  }
  return words;
}

/**
 * Turn a shape by `shift` sectors.
 *
 * Each ring is two words, so this is a 64-bit cyclic rotate done in 32-bit
 * halves. The `shift === 0` case is separate because `>>> 32` is a no-op in
 * JavaScript rather than zero, which would corrupt every ring silently.
 */
export function rotateShape(bits: Uint32Array, shift: number): Uint32Array {
  const k = ((shift % DIGIT_SECTORS) + DIGIT_SECTORS) % DIGIT_SECTORS;
  const out = new Uint32Array(DIGIT_WORDS);
  if (k === 0) {
    out.set(bits);
    return out;
  }
  for (let ring = 0; ring < DIGIT_RINGS; ring++) {
    const hi = bits[ring * 2]!;
    const lo = bits[ring * 2 + 1]!;
    let nhi: number;
    let nlo: number;
    if (k === 32) {
      nhi = lo;
      nlo = hi;
    } else if (k < 32) {
      nhi = ((hi << k) | (lo >>> (32 - k))) >>> 0;
      nlo = ((lo << k) | (hi >>> (32 - k))) >>> 0;
    } else {
      const j = k - 32;
      nhi = ((lo << j) | (hi >>> (32 - j))) >>> 0;
      nlo = ((hi << j) | (lo >>> (32 - j))) >>> 0;
    }
    out[ring * 2] = nhi;
    out[ring * 2 + 1] = nlo;
  }
  return out;
}

/** Bits set in a 32-bit word. */
function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

/** Agreement between two packed shapes, 0-1. */
export function similarity(a: Uint32Array, b: Uint32Array): number {
  if (a.length !== DIGIT_WORDS || b.length !== DIGIT_WORDS) return 0;
  let differing = 0;
  for (let w = 0; w < DIGIT_WORDS; w++) {
    differing += popcount((a[w]! ^ b[w]!) >>> 0);
  }
  return 1 - differing / DIGIT_CELLS;
}

/**
 * Best-matching value for a sampled digit.
 *
 * The SAMPLE is rotated rather than each template, so the 64 rotations are
 * computed once and reused across the whole library instead of once per
 * template.
 */
export function matchDigit(
  sample: Uint32Array,
  templates: readonly DigitTemplate[],
): DigitMatch | null {
  if (templates.length === 0 || sample.length !== DIGIT_WORDS) return null;

  const bestByValue = new Map<number, number>();
  let best: { value: number; score: number; shift: number } | null = null;

  for (let shift = 0; shift < DIGIT_SECTORS; shift++) {
    const turned = rotateShape(sample, shift);
    for (const template of templates) {
      if (template.bits.length !== DIGIT_WORDS) continue;
      const score = similarity(turned, template.bits);
      if (!best || score > best.score) best = { value: template.value, score, shift };
      const previous = bestByValue.get(template.value) ?? 0;
      if (score > previous) bestByValue.set(template.value, score);
    }
  }
  if (!best) return null;

  // Against the best OTHER value, not the runner-up template — two examples of
  // the same 6 scoring closely says nothing about ambiguity.
  let runnerUp = 0;
  for (const [value, score] of bestByValue) {
    if (value !== best.value && score > runnerUp) runnerUp = score;
  }

  return {
    value: best.value,
    score: best.score,
    margin: Math.max(0, best.score - runnerUp),
    shift: best.shift,
  };
}

/**
 * Lowest score worth acting on.
 *
 * Measured leave-one-photo-out over seven captures, precision climbs smoothly
 * with the threshold — 92.5% at 0.80, 96% at 0.85, 97% at 0.88, 98% at 0.90 —
 * and then holds at 100% across 0.91, 0.92 and 0.94, giving up only coverage
 * (86%, 85%, 81%). A plateau rather than a knife-edge, which is what makes it
 * worth trusting; 0.91 sits at its near edge with room on both sides.
 */
export const ACCEPT_SCORE = 0.91;

/**
 * Deliberately ignores `margin`, and that is not an oversight.
 *
 * Margin looks like it should be the safety check — a face matching two values
 * equally has said nothing — and it was originally documented that way. But
 * measured over 126 readings, margin is STRUCTURALLY ZERO for exactly one pair:
 *
 *     6   median margin 0.004   (rival: 9)
 *     9   median margin 0.004   (rival: 6)
 *     every other value          0.10 to 0.21
 *
 * Of course it is. A 6 turned 180 degrees IS a 9, so both templates match a 6
 * equally well and the margin between them is noise. `resolveSixNine` settles
 * that pair afterwards using ink colour and pip direction, which is the whole
 * reason it exists.
 *
 * So a margin gate would reject essentially every 6 and 9 on the board while
 * appearing to be a prudent safety check. Measured: requiring margin >= 0.02
 * drops 27 of 118 accepted readings — 22 of them 6s and 9s — and improves
 * precision by nothing, because precision is already 100%.
 */
export function isTrustworthy(match: DigitMatch, minScore = ACCEPT_SCORE): boolean {
  return match.score >= minScore;
}

/**
 * Settle 6 against 9, which shape alone can never do.
 *
 * A 6 turned 180 degrees IS a 9. The rotation invariance that makes this whole
 * approach work is exactly what creates this one ambiguity, and it is not a
 * defect to be tuned away — measured, EVERY accepted error before this fix was
 * this pair, at margins from +0.000 to +0.014.
 *
 * Two independent signals settle it, and they fail differently:
 *
 * - **Ink colour.** 6 and 8 are the only red tokens, so a red 6-or-9 is a 6.
 *   Measured 21/21. Depends on white balance.
 * - **Pip direction.** The pip row sits below the digit in the token's own
 *   frame, so it says which way is down. Measured 20/21, and colour-blind, so
 *   it survives lighting that would defeat the ink test. Note this uses only
 *   WHERE the pips are, never how many: the count is a function of the value
 *   (`PIPS_BY_VALUE`) and so is known already, and trying to READ it is what
 *   sank blob counting.
 *
 * Ink leads because it measured better. When only one is available it decides
 * alone. When they DISAGREE the value is returned as null rather than guessed —
 * that costs the player one tap and preserves the property that matters more
 * than accuracy: this reader does not commit to wrong numbers.
 */
export function resolveSixNine(
  value: number,
  inkIsRed: boolean | undefined,
  pipsSuggest: number | undefined,
): number | null {
  if (value !== 6 && value !== 9) return value;

  const byInk = inkIsRed === undefined ? undefined : inkIsRed ? 6 : 9;
  const byPips = pipsSuggest === 6 || pipsSuggest === 9 ? pipsSuggest : undefined;

  if (byInk !== undefined && byPips !== undefined) {
    return byInk === byPips ? byInk : null;
  }
  return byInk ?? byPips ?? value;
}

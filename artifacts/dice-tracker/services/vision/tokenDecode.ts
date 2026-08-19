/**
 * Read a Catan number token WITHOUT optical character recognition.
 *
 * Pure — operates on already-measured features, so it is fully unit-testable.
 *
 * THE IDEA
 * --------
 * Recognising a digit in a photo is hard. Counting blobs is easy. Every one of
 * the ten tokens is uniquely identified by three counts:
 *
 *   pips     the dots printed under the number (2 and 12 have one, 6 and 8 five)
 *   glyphs   how many digits — one, or two for 10/11/12
 *   holes    enclosed regions in the digits (Euler number): 5 has none, 6 one,
 *            8 two, 9 one, 0 one
 *
 *   token │ pips │ glyphs │ holes
 *   ──────┼──────┼────────┼──────
 *      2  │  1   │   1    │  0
 *      3  │  2   │   1    │  0
 *      4  │  3   │   1    │  0
 *      5  │  4   │   1    │  0
 *      6  │  5   │   1    │  1
 *      8  │  5   │   1    │  2
 *      9  │  4   │   1    │  1
 *     10  │  3   │   2    │  1
 *     11  │  2   │   2    │  0
 *     12  │  1   │   2    │  0
 *
 * All ten triples are distinct, so no digit is ever *recognised* — it is
 * deduced.
 *
 * WHY THIS SURVIVES THE REFERENCE PHOTOS
 * --------------------------------------
 * Tokens on a real board sit at every possible rotation; in the reference set
 * many read upside-down. Counting blobs, counting glyphs and counting holes are
 * all rotation-invariant, so orientation never has to be recovered.
 *
 * That also disposes of the classic 6/9 ambiguity, which rotation would
 * otherwise make unresolvable: 6 has five pips and 9 has four. Ink colour is a
 * second, independent check — 6 and 8 are the only tokens printed in red.
 */

/** Measurements taken from a token crop. */
export interface TokenFeatures {
  /** Small dots beneath the digits. */
  pipCount: number;
  /** Connected ink components forming the number itself: 1, or 2 for 10/11/12. */
  glyphCount: number;
  /** Enclosed background regions within the ink (Euler number). */
  holeCount: number;
  /** True when the ink is red rather than black. Only 6 and 8 are red. */
  isRed?: boolean;
}

export interface TokenReading {
  /** The decoded number, or null when the features match no real token. */
  value: number | null;
  /**
   * 'high'  every signal agreed
   * 'low'   decoded, but a cross-check disagreed — flag for a human glance
   * null value means undecodable; the constraint solver may still recover it
   */
  confidence: 'high' | 'low';
  /** Human-readable reason when something did not line up. */
  note?: string;
}

interface TokenSignature {
  value: number;
  pips: number;
  glyphs: number;
  holes: number;
  red: boolean;
}

/** The complete token set. 7 is absent — there is no 7 token. */
export const TOKEN_SIGNATURES: readonly TokenSignature[] = [
  { value: 2,  pips: 1, glyphs: 1, holes: 0, red: false },
  { value: 3,  pips: 2, glyphs: 1, holes: 0, red: false },
  { value: 4,  pips: 3, glyphs: 1, holes: 0, red: false },
  { value: 5,  pips: 4, glyphs: 1, holes: 0, red: false },
  { value: 6,  pips: 5, glyphs: 1, holes: 1, red: true  },
  { value: 8,  pips: 5, glyphs: 1, holes: 2, red: true  },
  { value: 9,  pips: 4, glyphs: 1, holes: 1, red: false },
  { value: 10, pips: 3, glyphs: 2, holes: 1, red: false },
  { value: 11, pips: 2, glyphs: 2, holes: 0, red: false },
  { value: 12, pips: 1, glyphs: 2, holes: 0, red: false },
];

/** Pip count → the token number, for the pip signal alone. */
export const PIPS_BY_VALUE: Readonly<Record<number, number>> = Object.fromEntries(
  TOKEN_SIGNATURES.map(s => [s.value, s.pips]),
);

/**
 * Decode a token from its measured features.
 *
 * Pips are the most reliable signal — they are large, well separated, and
 * identical on every token — so they are matched first and the remaining
 * signals disambiguate within the pair they select.
 */
export function decodeToken(features: TokenFeatures): TokenReading {
  const { pipCount, glyphCount, holeCount, isRed } = features;

  const byPips = TOKEN_SIGNATURES.filter(s => s.pips === pipCount);
  if (byPips.length === 0) {
    return { value: null, confidence: 'low', note: `No token has ${pipCount} pips.` };
  }

  const byGlyphs = byPips.filter(s => s.glyphs === glyphCount);
  const candidates = byGlyphs.length > 0 ? byGlyphs : byPips;

  const exact = candidates.filter(s => s.holes === holeCount);
  if (exact.length === 1) {
    const match = exact[0]!;
    // Ink colour is an independent check, so a disagreement is worth surfacing
    // even though the counts were decisive.
    if (isRed !== undefined && isRed !== match.red) {
      return {
        value: match.value,
        confidence: 'low',
        note: `Counts say ${match.value}, but the ink colour disagrees.`,
      };
    }
    return { value: match.value, confidence: byGlyphs.length > 0 ? 'high' : 'low' };
  }

  if (exact.length > 1) {
    // Should be unreachable for the real token set; kept so a future variant
    // deck degrades to "uncertain" rather than silently picking one.
    return {
      value: null,
      confidence: 'low',
      note: `Ambiguous: ${exact.map(s => s.value).join(' or ')}.`,
    };
  }

  // Hole count disagreed with everything — blur or glare filling a loop is the
  // usual cause. Fall back to colour when it can settle the remaining pair.
  if (candidates.length === 1) {
    return {
      value: candidates[0]!.value,
      confidence: 'low',
      note: 'Hole count did not match; decided on pips alone.',
    };
  }
  if (isRed !== undefined) {
    const byColour = candidates.filter(s => s.red === isRed);
    if (byColour.length === 1) {
      return {
        value: byColour[0]!.value,
        confidence: 'low',
        note: 'Hole count did not match; decided on ink colour.',
      };
    }
  }
  return {
    value: null,
    confidence: 'low',
    note: `Could not separate ${candidates.map(s => s.value).join(' / ')}.`,
  };
}

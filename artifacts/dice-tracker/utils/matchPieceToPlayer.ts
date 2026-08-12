/**
 * matchPieceToPlayer — maps a detected piece color string to the closest
 * player by perceptual RGB distance.
 *
 * Accepts CSS hex colors (#rgb / #rrggbb) and a curated set of common
 * Catan piece color names.  Returns null when no player is within the
 * MATCH_THRESHOLD Euclidean distance.
 */

import type { Player } from '@/types/models';

// ─── Common CSS color names → approximate RGB ─────────────────────────────────

const COLOR_NAMES: Record<string, [number, number, number]> = {
  red:    [220,  38,  38],
  blue:   [ 37,  99, 235],
  white:  [255, 255, 255],
  orange: [234,  88,  12],
  green:  [ 22, 163,  74],
  brown:  [120,  70,  30],
  yellow: [234, 179,   8],
  black:  [  0,   0,   0],
  purple: [147,  51, 234],
  pink:   [236,  72, 153],
  gray:   [107, 114, 128],
  grey:   [107, 114, 128],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, '').toLowerCase();
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/** Parse a CSS color string (hex or name) to an [R, G, B] triple, or null. */
function parseColor(colorStr: string): [number, number, number] | null {
  const lower = colorStr.toLowerCase().trim();
  if (COLOR_NAMES[lower]) return COLOR_NAMES[lower]!;
  return hexToRgb(lower);
}

function rgbDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2,
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Maximum RGB Euclidean distance (0–441) considered a valid color match. */
export const MATCH_THRESHOLD = 120;

/**
 * Returns the player whose color is closest to `detectedColor`, provided the
 * distance is within MATCH_THRESHOLD.  Returns null if no player is close
 * enough or if the color string cannot be parsed.
 */
export function matchPieceToPlayer(
  detectedColor: string,
  players: Player[],
): Player | null {
  const detectedRgb = parseColor(detectedColor);
  if (!detectedRgb) return null;

  let bestPlayer: Player | null = null;
  let bestDist = Infinity;

  for (const player of players) {
    const playerRgb = parseColor(player.color);
    if (!playerRgb) continue;
    const dist = rgbDistance(detectedRgb, playerRgb);
    if (dist < bestDist) {
      bestDist = dist;
      bestPlayer = player;
    }
  }

  return bestDist <= MATCH_THRESHOLD ? bestPlayer : null;
}

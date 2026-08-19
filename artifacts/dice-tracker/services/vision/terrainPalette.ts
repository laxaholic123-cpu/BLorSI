/**
 * Terrain colour references, measured from real board photos.
 *
 * Pure — no image decoding, no React Native.
 *
 * CALIBRATION
 * -----------
 * These are not guesses. They were derived by pooling the land pixels from a
 * twelve-photo reference set spanning warm indoor light, direct glare and
 * shadow, converting to CIE L*a*b*, and clustering. The cluster centres below
 * are what a real board actually measures.
 *
 * L*a*b* rather than RGB because distance in Lab approximates perceived colour
 * difference, and because it separates lightness (which glare wrecks) from
 * chroma (which glare largely preserves). That separation is what lets a
 * washed-out tile still be classified from its hue.
 */

import type { ResourceType } from '@/types/models';

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** Reference colour per terrain, from the calibration set. */
export const TERRAIN_REFERENCES: Readonly<Record<string, Lab>> = {
  grain: { L: 61.5, a: 4.6, b: 46.2 },   // fields — gold, strongly yellow
  wool: { L: 53.2, a: -25.6, b: 38.6 },  // pasture — vivid green
  lumber: { L: 37.7, a: -7.1, b: 16.4 }, // forest — dark, desaturated green
  brick: { L: 36.8, a: 15.4, b: 23.2 },  // hills — red-brown
  ore: { L: 60.3, a: -0.5, b: 0.1 },     // mountains — near-neutral grey
  desert: { L: 72.3, a: -2.2, b: 25.8 }, // pale tan
};

export const TERRAIN_CLASSES: ResourceType[] = [
  'grain', 'wool', 'lumber', 'brick', 'ore', 'desert',
];

// ─── Colour conversion ────────────────────────────────────────────────────────

/** sRGB (0–255) → CIE L*a*b* under a D65 white point. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);

  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;

  const e = 216 / 24389;
  const k = 24389 / 27;
  const f = (t: number) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * Distance between two colours, with lightness deliberately down-weighted.
 *
 * Glare and shadow move L* enormously while leaving hue roughly intact — a
 * sunlit pasture and a shaded pasture differ by tens of L* but stay green. The
 * reference set contains tiles at both extremes, so weighting chroma above
 * lightness is what keeps them classifying together.
 */
export function labDistance(x: Lab, y: Lab, lightnessWeight = 0.4): number {
  const dL = (x.L - y.L) * lightnessWeight;
  const da = x.a - y.a;
  const db = x.b - y.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** Per-terrain distance from a sampled colour. Lower is a better match. */
export function terrainDistances(sample: Lab): Record<string, number> {
  const out: Record<string, number> = {};
  for (const terrain of TERRAIN_CLASSES) {
    out[terrain] = labDistance(sample, TERRAIN_REFERENCES[terrain]!);
  }
  return out;
}

/** Best single guess for a sampled colour, ignoring board-level constraints. */
export function nearestTerrain(sample: Lab): { terrain: ResourceType; distance: number } {
  let best: ResourceType = 'desert';
  let bestDistance = Infinity;
  for (const terrain of TERRAIN_CLASSES) {
    const d = labDistance(sample, TERRAIN_REFERENCES[terrain]!);
    if (d < bestDistance) {
      bestDistance = d;
      best = terrain;
    }
  }
  return { terrain: best, distance: bestDistance };
}

// ─── Robust sampling ──────────────────────────────────────────────────────────

/**
 * Median colour of a set of samples, per channel.
 *
 * Median rather than mean because board art is textured — trees, furrows, rock
 * faces — and because glare produces a few blown-out pixels that would drag a
 * mean a long way. A median shrugs both off.
 */
export function medianLab(samples: readonly Lab[]): Lab | null {
  if (samples.length === 0) return null;
  const pick = (get: (s: Lab) => number) => {
    const sorted = samples.map(get).sort((x, y) => x - y);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return { L: pick(s => s.L), a: pick(s => s.a), b: pick(s => s.b) };
}

/**
 * Neutralise a colour cast using the board's own average.
 *
 * Indoor lighting shifts every tile the same direction — warm bulbs push the
 * whole board yellow, which drags pasture toward wheat. Subtracting the board's
 * mean chroma offset from a neutral reference removes the shared cast without
 * touching the differences between tiles, which is all the classifier uses.
 */
export function whiteBalance(samples: readonly Lab[], boardMean: Lab): Lab[] {
  // The calibration set's average chroma across all terrains. A board lit
  // neutrally sits near here; the offset from it is the cast to remove.
  const NEUTRAL_A = -2.2;
  const NEUTRAL_B = 25.6;
  const shiftA = boardMean.a - NEUTRAL_A;
  const shiftB = boardMean.b - NEUTRAL_B;
  return samples.map(s => ({ L: s.L, a: s.a - shiftA, b: s.b - shiftB }));
}

/** Mean of a set of Lab samples — used to estimate the board's colour cast. */
export function meanLab(samples: readonly Lab[]): Lab | null {
  if (samples.length === 0) return null;
  let L = 0, a = 0, b = 0;
  for (const s of samples) { L += s.L; a += s.a; b += s.b; }
  const n = samples.length;
  return { L: L / n, a: a / n, b: b / n };
}

// ─── Sample quality ───────────────────────────────────────────────────────────

/**
 * Chroma — how far a colour sits from neutral grey.
 *
 * Terrain art is saturated; glare, shadow and the cream of a number token are
 * not. Chroma is therefore a decent proxy for "is this actually terrain".
 */
export function chroma(c: Lab): number {
  return Math.hypot(c.a, c.b);
}

export type SampleQuality = 'good' | 'washed_out' | 'too_dark';

/**
 * Judge whether a sample is worth classifying at all.
 *
 * Measured on the reference set: running the classifier over every land pixel
 * sent a quarter of them to 'ore' and a third to 'desert', because blown-out
 * highlights go neutral-grey and pale surfaces go tan. Those are exactly the two
 * references a degraded pixel lands on by accident, so a classifier that always
 * answers will confidently mislabel every glare patch as mountains and every
 * washed surface as desert.
 *
 * Refusing to answer is better. An unreliable sample should contribute NO
 * opinion to the constraint solver, which then fills the tile from whatever the
 * box has left over — and that is very often exactly right.
 */
export function sampleQuality(c: Lab): SampleQuality {
  if (c.L < 18) return 'too_dark';
  if (c.L > 82 && chroma(c) < 18) return 'washed_out';
  return 'good';
}

/**
 * Per-terrain costs for the constraint solver, or an empty object when the
 * sample cannot be trusted.
 *
 * Returning nothing is a deliberate signal, not a failure: the solver treats an
 * absent opinion as free, so a glare-blanked tile costs nothing to place
 * wherever the remaining components require.
 */
export function terrainCosts(sample: Lab): Record<string, number> {
  if (sampleQuality(sample) !== 'good') return {};
  return terrainDistances(sample);
}

// ─── Board-relative classification ────────────────────────────────────────────
//
// Everything above compares a tile to a FIXED reference colour. That works until
// the light changes, and then it fails on whole tiles at once.
//
// The functions below take a different approach, and measurement says it is
// substantially better: compare the nineteen tiles TO EACH OTHER. We know
// exactly what the board contains, so the useful question is not "is this tile
// close to reference grey?" but "which three of these nineteen are the greyest?"
// Ranking is invariant to any shift that moves every tile together, which is
// precisely what illumination does.

/**
 * Surface roughness per terrain, as a rank rather than a measurement.
 *
 * This is a property of the materials, not of any particular board: a forest
 * canopy is the most broken-up surface, sand is the smoothest, rock and hills
 * sit between. Measured on a reference board the ordering held exactly, and
 * using only this coarse ordering — with no tuned values — classified all 19
 * tiles correctly.
 *
 * Texture matters because it separates tiles that collide in colour. Mountains
 * and forest can both read as dark and desaturated under bad light; they never
 * read as equally smooth.
 */
export const TERRAIN_ROUGHNESS: Readonly<Record<string, number>> = {
  lumber: 1.0,   // forest canopy — most broken up
  brick: 0.85,   // hills, furrowed clay
  ore: 0.6,      // rock faces
  grain: 0.35,   // fields
  wool: 0.3,     // pasture
  desert: 0.0,   // smooth sand
};

/** Mean and spread of a set of numbers, for standardising. */
function standardise(values: readonly number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 1 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.max(Math.sqrt(variance), 1e-6) };
}

/** The reference colours' own distribution, weighted by how many tiles the box holds. */
function referenceMoments(): { mu: Lab; sd: Lab } {
  const counts: Record<string, number> = {
    grain: 4, wool: 4, lumber: 4, brick: 3, ore: 3, desert: 1,
  };
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const acc = { L: 0, a: 0, b: 0 };
  for (const t of TERRAIN_CLASSES) {
    const w = counts[t]! / total;
    const r = TERRAIN_REFERENCES[t]!;
    acc.L += w * r.L; acc.a += w * r.a; acc.b += w * r.b;
  }
  const varr = { L: 0, a: 0, b: 0 };
  for (const t of TERRAIN_CLASSES) {
    const w = counts[t]! / total;
    const r = TERRAIN_REFERENCES[t]!;
    varr.L += w * (r.L - acc.L) ** 2;
    varr.a += w * (r.a - acc.a) ** 2;
    varr.b += w * (r.b - acc.b) ** 2;
  }
  return {
    mu: acc,
    sd: {
      L: Math.max(Math.sqrt(varr.L), 1e-6),
      a: Math.max(Math.sqrt(varr.a), 1e-6),
      b: Math.max(Math.sqrt(varr.b), 1e-6),
    },
  };
}

/** How much weight texture carries. Stable anywhere from 0.2 to 2.0. */
export const TEXTURE_WEIGHT = 0.7;

export interface TileObservation {
  colour: Lab | null;
  /** Luminance spread across the tile's face — high for rock and forest. */
  roughness: number | null;
}

/**
 * Classify a whole board at once, by comparing its tiles to each other.
 *
 * Returns per-tile costs for the constraint solver. Tiles with no usable
 * observation get an empty cost map, which costs the solver nothing and lets the
 * component counts place them.
 *
 * Doing this board-at-a-time rather than tile-at-a-time is the point: the
 * standardisation only makes sense across the whole set, and it is what makes
 * the result independent of exposure and colour cast.
 */
export function classifyBoardRelative(
  observations: readonly TileObservation[],
): Record<string, number>[] {
  const usable = observations.filter(o => o.colour !== null);
  if (usable.length < 6) return observations.map(() => ({}));

  const Ls = standardise(usable.map(o => o.colour!.L));
  const As = standardise(usable.map(o => o.colour!.a));
  const Bs = standardise(usable.map(o => o.colour!.b));

  const roughValues = observations
    .map(o => o.roughness)
    .filter((r): r is number => typeof r === 'number');
  const Rs = standardise(roughValues);

  const priorValues = TERRAIN_CLASSES.map(t => TERRAIN_ROUGHNESS[t]!);
  const Ps = standardise(priorValues);

  const { mu, sd } = referenceMoments();

  return observations.map(obs => {
    if (!obs.colour) return {};
    const z = {
      L: (obs.colour.L - Ls.mean) / Ls.sd,
      a: (obs.colour.a - As.mean) / As.sd,
      b: (obs.colour.b - Bs.mean) / Bs.sd,
    };
    const zRough =
      typeof obs.roughness === 'number' ? (obs.roughness - Rs.mean) / Rs.sd : null;

    const costs: Record<string, number> = {};
    for (const terrain of TERRAIN_CLASSES) {
      const ref = TERRAIN_REFERENCES[terrain]!;
      const zr = {
        L: (ref.L - mu.L) / sd.L,
        a: (ref.a - mu.a) / sd.a,
        b: (ref.b - mu.b) / sd.b,
      };
      // Lightness stays down-weighted: it is the channel illumination ruins.
      const dL = (z.L - zr.L) * 0.4;
      let cost = Math.sqrt(dL * dL + (z.a - zr.a) ** 2 + (z.b - zr.b) ** 2);

      if (zRough !== null) {
        const zp = (TERRAIN_ROUGHNESS[terrain]! - Ps.mean) / Ps.sd;
        cost += TEXTURE_WEIGHT * Math.abs(zRough - zp);
      }
      costs[terrain] = cost;
    }
    return costs;
  });
}

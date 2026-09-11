/**
 * Which resource does each harbour trade?
 *
 * Positions are settled by `harbourRing.ts`; this is the other half. Ported
 * from `tools/harbour_probe.py`, measured leave-one-capture-out at **92.2% with
 * the composition constraint against 80.0% without** — the same move that took
 * the number tokens from 94% to 180/180.
 *
 * THE HISTORY MATTERS, because three earlier attempts all failed the same way
 * and the shape recurs. Reading a harbour's type off colour did not work:
 *
 *   1. "Saturated pixels in a window" measured the SEA, which is the most
 *      saturated thing in frame, so every badge read as cyan.
 *   2. "Icon as bright non-cream" discarded ore and the lumber log for being
 *      dark — two of the six types, invisible to the test meant to find them.
 *   3. Every attempt measured a square that always contained boat and dock.
 *
 * What fixed it: work inside the CARD (the cream region), take the icon as the
 * largest non-cream blob whatever its colour, and describe the card by colour
 * bins rather than by one segmented icon. The blob rule matters because ORE is
 * grey and WOOL is white — a saturation predicate cannot see either, and those
 * were exactly the two that kept swapping. That is this repo's oldest failure
 * shape: the predicate excluded the very thing it was looking for.
 */

import { connectedComponents, type BinaryMask } from '@/services/vision/binaryOps';
import { applyHomography, type Matrix3, type Point } from '@/services/vision/homography';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import type { PortType } from '@/types/models';

/**
 * Feature order. Must match FEATURES in `tools/harbour_probe.py`, because the
 * bundled profiles below are indexed by position — a reorder here silently
 * compares brick's redness against grain's hue.
 */
export const FEATURE_NAMES = [
  'icon', 'dark', 'satcol', 'r', 'g', 'b', 'hue',
  'bin_red', 'bin_gold', 'bin_green', 'bin_dark', 'bin_mid', 'bin_pale',
] as const;

// Harvested by `python tools/harbour_probe.py profiles` from 90 badges across
// 10 captures. MEDIAN per type, not mean: one badge under glare drags a mean,
// and with ten examples per resource that pull is large.
export const TYPE_PROFILES: Record<string, readonly number[]> = {
  generic: [0.036658, 0.039521, 0.020538, 0.564258, 0.493837, 0.536458, 0.045818, 0.000000, 0.114803, 0.000594, 0.031199, 0.130447, 0.000000],
  brick: [0.217849, 0.019706, 0.253364, 0.935273, 0.516715, 0.477279, 0.029469, 0.237820, 0.098145, 0.003338, 0.025507, 0.059183, 0.036769],
  lumber: [0.229641, 0.068752, 0.242193, 0.646805, 0.499549, 0.424022, 0.070019, 0.102509, 0.131947, 0.026021, 0.103321, 0.036099, 0.019393],
  grain: [0.214616, 0.026585, 0.233653, 1.029057, 0.821232, 0.504162, 0.099126, 0.209394, 0.114288, 0.091853, 0.010512, 0.067645, 0.117631],
  ore: [0.210830, 0.145743, 0.146360, 0.522860, 0.440084, 0.394692, 0.079110, 0.001679, 0.115268, 0.000000, 0.117136, 0.127453, 0.000000],
  wool: [0.107168, 0.049516, 0.157589, 0.626218, 0.555216, 0.440472, 0.112765, 0.008153, 0.182593, 0.069382, 0.030089, 0.094599, 0.002454],
};

/**
 * Per-axis spread (interquartile / 1.35) across the training set, so no axis
 * dominates the distance.
 *
 * From the TRAINING rows, NOT from the nine badges being classified. Scaling by
 * the nine made the axes depend on the very thing being measured, and it cost
 * more than the constraint gained — constrained accuracy fell BELOW plain
 * nearest-profile, which is the tell that the cost matrix is wrong rather than
 * the assignment.
 */
export const FEATURE_SCALE: readonly number[] = [
  0.132513, 0.032265, 0.155785, 0.089222, 0.065728, 0.077575, 0.049109,
  0.083211, 0.045829, 0.015463, 0.031259, 0.048712, 0.018596,
];

/** One 2:1 per resource, four 3:1. Straight from the box. */
export const PORT_SLOTS: readonly PortType[] = [
  'generic', 'generic', 'generic', 'generic',
  'brick', 'lumber', 'grain', 'ore', 'wool',
];

/** Half-width of the sampled badge patch, in canonical units. */
const RECTIFY_HALF = 0.38;
/** Side of the rectified patch, in pixels. Matches the probe. */
export const RECTIFY_SIZE = 96;

/** Outward unit normal of a hex edge, in canonical space (+y down). */
function edgeDirection(edge: number): Point {
  const th = ((240 + 60 * edge) * Math.PI) / 180;
  return { x: Math.cos(th), y: Math.sin(th) };
}

/**
 * Sample a badge UPRIGHT, in badge space rather than image space.
 *
 * The card faces out along its edge normal, so that normal defines the frame.
 * Sampling a square in this frame puts the card in the same place in every crop
 * regardless of where the harbour sits on the coast or how the photo was taken
 * — which is what every earlier attempt lacked, and why they all ended up
 * measuring the boat.
 *
 * Pass `centre` from the DETECTED blob when there is one. The predicted spot is
 * right on average and off by up to a third of a radius on any given photo,
 * which is enough to clip the card or pull the neighbouring dock into the
 * patch, and a contaminated patch is what the earlier attempts measured.
 */
export function rectifyBadge(
  buf: PixelBuffer,
  toImage: Matrix3,
  centre: Point,
  edge: number,
  size = RECTIFY_SIZE,
): PixelBuffer {
  const n = edgeDirection(edge);
  const t = { x: -n.y, y: n.x }; // along the coast
  const out = new Uint8Array(size * size * 4);

  for (let row = 0; row < size; row++) {
    const v = -RECTIFY_HALF + (2 * RECTIFY_HALF * row) / (size - 1);
    for (let col = 0; col < size; col++) {
      const u = -RECTIFY_HALF + (2 * RECTIFY_HALF * col) / (size - 1);
      const p = applyHomography(toImage, {
        x: centre.x + u * t.x + v * n.x,
        y: centre.y + u * t.y + v * n.y,
      });
      const o = (row * size + col) * 4;
      if (!p) {
        out[o + 3] = 255;
        continue;
      }
      // Nearest neighbour, matching the probe exactly. Fidelity to the
      // reference implementation beats a nicer filter here: the profiles above
      // were trained through this sampling and would not transfer to another.
      const x = Math.min(buf.width - 1, Math.max(0, Math.round(p.x)));
      const y = Math.min(buf.height - 1, Math.max(0, Math.round(p.y)));
      const i = (y * buf.width + x) * 4;
      out[o] = buf.data[i]!;
      out[o + 1] = buf.data[i + 1]!;
      out[o + 2] = buf.data[i + 2]!;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: size, height: size };
}

/**
 * 4-connected labelling that keeps the PIXELS of each component.
 *
 * `binaryOps.connectedComponents` reports bounds and centroid but not
 * membership, and the icon's mean colour needs the actual pixels. Kept local
 * rather than widening that shared return shape for one caller.
 */
function labelBlobs(mask: boolean[], width: number, height: number): number[][] {
  const seen = new Uint8Array(mask.length);
  const out: number[][] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    const pixels: number[] = [];
    while (stack.length > 0) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - width] && !seen[i - width]) { seen[i - width] = 1; stack.push(i - width); }
      if (y < height - 1 && mask[i + width] && !seen[i + width]) { seen[i + width] = 1; stack.push(i + width); }
    }
    out.push(pixels);
  }
  return out;
}

/**
 * Describe the CARD in a rectified badge, ignoring sea and boat.
 *
 * Returns the 13 features in `FEATURE_NAMES` order, or null when the patch does
 * not contain enough card to describe — a badge clipped by the photo edge, or
 * a crop that landed on open water.
 */
export function cardFeatures(patch: PixelBuffer): number[] | null {
  const { width, height, data } = patch;
  const n = width * height;
  const sat = new Float64Array(n);
  const val = new Float64Array(n);
  const sea: boolean[] = new Array(n);
  const cream: boolean[] = new Array(n);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat[i] = mx > 0 ? (mx - mn) / Math.max(mx, 1e-9) : 0;
    val[i] = mx / 255;
    sea[i] = b > r + 25 && b > 60 && g > r;
    cream[i] = !sea[i] && val[i]! > 0.45 && sat[i]! < 0.34;
  }

  let creamCount = 0, sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) {
    if (!cream[i]) continue;
    creamCount++;
    sumX += i % width;
    sumY += (i / width) | 0;
  }
  if (creamCount < 40) return null;

  const cx = sumX / creamCount;
  const cy = sumY / creamCount;
  const rad = Math.max(6, Math.sqrt(creamCount / Math.PI) * 1.25);

  const card: boolean[] = new Array(n);
  let cardCount = 0;
  for (let i = 0; i < n; i++) {
    const dx = (i % width) - cx;
    const dy = ((i / width) | 0) - cy;
    card[i] = Math.hypot(dx, dy) < rad && !sea[i];
    if (card[i]) cardCount++;
  }
  if (cardCount < 60) return null;

  /*
    THE ICON IS THE LARGEST NON-CREAM BLOB, whatever colour it is.

    Largest-blob rather than most-saturated, because ore is grey and wool is
    white and a saturation test sees neither — both scored as having no icon and
    were read as 3:1. It works because the competing marks are TEXT: "2:1" is
    several small thin components, an icon is one big one. Same reasoning that
    made the digit reader take the largest blob in a token face.
  */
  const ink: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) ink[i] = card[i]! && !cream[i];
  const icon: boolean[] = new Array(n).fill(false);
  let iconCount = 0;
  const comps = labelBlobs(ink, width, height);
  if (comps.length > 0) {
    let biggest = comps[0]!;
    for (const c of comps) if (c.length > biggest.length) biggest = c;
    if (biggest.length >= 20) {
      for (const i of biggest) icon[i] = true;
      iconCount = biggest.length;
    }
  }

  let darkCount = 0, satcolCount = 0;
  for (let i = 0; i < n; i++) {
    if (!card[i]) continue;
    if (val[i]! < 0.34) darkCount++;
    if (sat[i]! > 0.3 && val[i]! > 0.18) satcolCount++;
  }

  /*
    THE CARD IS ITS OWN LIGHT METER.

    Raw icon colour is not comparable between captures: one photo is warm
    lamplight, the next daylight, and the same printed red lands somewhere else
    in RGB. Every badge carries its own reference — the cream card the icon is
    printed on. Dividing by it cancels the illumination and leaves the ink,
    which is the part that actually differs between a brick and a sheaf.
  */
  let refR = 0, refG = 0, refB = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!cream[i]) continue;
    refR += data[p]!;
    refG += data[p + 1]!;
    refB += data[p + 2]!;
  }
  refR = Math.max(refR / creamCount, 1);
  refG = Math.max(refG / creamCount, 1);
  refB = Math.max(refB / creamCount, 1);

  let mr = 0, mg = 0, mb = 0;
  let hue = 0;
  if (iconCount > 20) {
    let ir = 0, ig = 0, ib = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (!icon[i]) continue;
      ir += data[p]!;
      ig += data[p + 1]!;
      ib += data[p + 2]!;
    }
    ir /= iconCount; ig /= iconCount; ib /= iconCount;
    mr = ir / refR; mg = ig / refG; mb = ib / refB;
    const deg = (Math.atan2(Math.sqrt(3) * (ig - ib), 2 * ir - ig - ib) * 180) / Math.PI;
    hue = (((deg % 360) + 360) % 360) / 360;
  }

  /*
    COLOUR BINS OVER THE WHOLE CARD, not one segmented icon.

    Segmenting fails on wool specifically: a WHITE sheep on a cream card leaves
    almost nothing non-cream except its outline, so the "icon" became a thin
    dark shape indistinguishable from grey ore — exactly the pair that kept
    swapping. Describing the card by what colours are ON it sidesteps the
    segmentation, and a 3:1 is then simply the card with nothing but cream and
    text.
  */
  let binRed = 0, binGold = 0, binGreen = 0, binDark = 0, binMid = 0, binPale = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!card[i]) continue;
    const cr = data[p]! / refR;
    const cg = data[p + 1]! / refG;
    const cb = data[p + 2]! / refB;
    const lum = (cr + cg + cb) / 3;
    const warm = cr - (cg + cb) / 2;
    const green = cg - (cr + cb) / 2;
    if (warm > 0.18 && lum > 0.35) binRed++;
    if (warm > 0.06 && warm <= 0.18 && lum > 0.55) binGold++;
    if (green > 0.05) binGreen++;
    if (lum < 0.45) binDark++;
    if (lum >= 0.45 && lum < 0.78 && Math.abs(warm) <= 0.1) binMid++;
    if (lum >= 0.78 && !cream[i]) binPale++;
  }

  const t = cardCount;
  return [
    iconCount / t, darkCount / t, satcolCount / t,
    mr, mg, mb, hue,
    binRed / t, binGold / t, binGreen / t, binDark / t, binMid / t, binPale / t,
  ];
}

/**
 * Profiles and per-axis scale to classify against.
 *
 * Overridable so the port check can supply HELD-OUT profiles. Measuring the
 * bundled ones against the captures they were trained on would report an
 * accuracy no new photo will ever see.
 */
export interface TypeModel {
  profiles: Record<string, readonly number[]>;
  scale: readonly number[];
}

const BUNDLED: TypeModel = { profiles: TYPE_PROFILES, scale: FEATURE_SCALE };

/** Scaled Euclidean distance from a feature vector to a type's profile. */
export function typeDistance(
  feature: readonly number[],
  type: string,
  model: TypeModel = BUNDLED,
): number {
  const prof = model.profiles[type];
  if (!prof) return Infinity;
  let sum = 0;
  for (let i = 0; i < prof.length; i++) {
    const d = ((feature[i] ?? 0) - prof[i]!) / (model.scale[i] || 1e-3);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface TypeAssignment {
  types: PortType[];
  /** Total cost of the chosen assignment. Lower is a better fit. */
  cost: number;
  /**
   * How much worse the next materially different assignment is.
   *
   * Small means the photo did not really decide, the same way `selectRing`'s
   * margin does for positions.
   */
  margin: number;
}

/**
 * Best type per badge, SUBJECT TO the box's composition.
 *
 * Four 3:1 and exactly one 2:1 per resource. That turns "which type is this
 * badge" into an assignment with no freedom to spend, and it is worth 12 points
 * of accuracy (92.2% against 80.0%) on identical scores.
 *
 * Exhaustive over the 9!/4! = 15120 distinct labellings — choose which four
 * badges are generic (126 ways), then permute five resources over the rest
 * (120). Exactness is the point: a greedy pass spends the single `ore` slot on
 * whichever badge happens to score first.
 */
export function assignTypes(
  features: readonly (readonly number[] | null)[],
  model: TypeModel = BUNDLED,
): TypeAssignment {
  const nine = features.length;
  const cost: number[][] = features.map(f =>
    PORT_SLOTS.map(t => (f ? typeDistance(f, t, model) : 0)),
  );

  const resources = PORT_SLOTS.filter(t => t !== 'generic');
  let best: PortType[] | null = null;
  let bestCost = Infinity;
  let runnerUp = Infinity;

  const idx = Array.from({ length: nine }, (_, i) => i);
  // Choose the four generics.
  const choose = (startAt: number, picked: number[]): void => {
    if (picked.length === 4) {
      const isGeneric = new Set(picked);
      const rest = idx.filter(i => !isGeneric.has(i));
      let base = 0;
      for (const i of picked) base += cost[i]![0]!;

      // Permute the five resources over the remaining badges.
      const perm: number[] = [];
      const used = new Array(rest.length).fill(false);
      const walk = (depth: number, acc: number): void => {
        if (acc >= bestCost && acc >= runnerUp) return; // cannot win or place
        if (depth === rest.length) {
          if (acc < bestCost) {
            runnerUp = bestCost;
            bestCost = acc;
            const out: PortType[] = new Array(nine).fill('generic');
            for (let k = 0; k < rest.length; k++) out[rest[k]!] = resources[perm[k]!]!;
            best = out;
          } else if (acc < runnerUp) {
            runnerUp = acc;
          }
          return;
        }
        for (let r = 0; r < resources.length; r++) {
          if (used[r]) continue;
          used[r] = true;
          perm[depth] = r;
          walk(depth + 1, acc + cost[rest[depth]!]![4 + r]!);
          used[r] = false;
        }
      };
      walk(0, base);
      return;
    }
    for (let i = startAt; i < nine; i++) choose(i + 1, [...picked, i]);
  };

  if (nine === 9) choose(0, []);

  return {
    types: best ?? PORT_SLOTS.slice(0, nine).map(t => t),
    cost: Number.isFinite(bestCost) ? bestCost : 0,
    margin: Number.isFinite(runnerUp) && Number.isFinite(bestCost) ? runnerUp - bestCost : 0,
  };
}

/**
 * Finding the nine harbour badges in a board photo.
 *
 * The pixel half of harbour reading; `harbourRing.ts` is the structural half
 * that turns these noisy detections into an exact answer. Ported from
 * `tools/harbour_probe.py`, which measured 90/90 harbours across ten captures —
 * every constant here was fitted there rather than guessed, so changing one
 * means re-running that probe, not reasoning about it.
 *
 * The badges are cream cards floating in the blue sea ring outside the island.
 * Two things make them harder to find than that sounds, and both cost real time
 * before they were understood:
 *
 *   1. The board sits on a WHITE CLOTH, which is also bright and unsaturated
 *      and outweighs every badge put together. Brightness alone finds the
 *      tablecloth. The fix is the enclosure test: a badge is surrounded by sea,
 *      the cloth is not.
 *   2. The island's own pale tiles — desert especially — read as cream. The fix
 *      is masking the island out by projected hex discs before looking at all.
 */

import { connectedComponents, type BinaryMask } from '@/services/vision/binaryOps';
import { HEX_CENTERS, CORNER_HEX_CENTERS } from '@/services/vision/boardGeometry';
import {
  applyHomography,
  solveHomography,
  type Matrix3,
  type Point,
} from '@/services/vision/homography';
import { downscale, type PixelBuffer } from '@/services/vision/pixelBuffer';
import {
  COASTAL_RING,
  edgeKey,
  selectRing,
  type RingChoice,
  type RingSlot,
} from '@/services/vision/harbourRing';
import { assignTypes, cardFeatures, rectifyBadge } from '@/services/vision/harbourTypes';
import type { PortType } from '@/types/models';

/** Centre-to-edge distance of a unit hex. */
const APOTHEM = Math.cos(Math.PI / 6);

/**
 * How far beyond the coastal edge midpoint the badge centre sits, in hex radii.
 *
 * Fitted against detected badges across both physical boards; 0.65 was the best
 * single value. The harbour card is not at the water's edge — it sits out in
 * the sea ring with its little boat, and assuming otherwise put every predicted
 * position half a hex inside the coastline.
 */
export const BADGE_OUT = 0.65;

/**
 * How close a blob must be to a predicted badge position to count as evidence
 * for that edge, in canonical units. Also the falloff distance.
 *
 * Note what this radius necessarily does, because it looks like a bug when you
 * first see it in the scores. The thirty predicted positions are NOT evenly
 * spaced: measured, twelve of the thirty neighbour gaps are 0.216 units and the
 * other eighteen are 1.516. The short ones are the convex corners of the coast,
 * where two edges of adjacent hexes point almost the same way and their badges
 * land nearly on top of each other. So one real badge always lights up TWO
 * edges — its own at 1.0 and its corner partner at about 0.75.
 *
 * That is fine, and it is not worth narrowing the radius to avoid. A pair that
 * close is one ring index apart, and legal rings step by 3 or 4, so no ring can
 * contain both; the constraint throws the partner out and the 0.25 difference
 * decides which of the two is real. Narrowing the radius instead would cost the
 * graded falloff that recovers glare-washed badges, which is the more valuable
 * property of the two.
 */
const MATCH_RADIUS = 0.85;

/** Longest side of the image the detector actually works on. */
const WORKING_MAX_DIM = 900;

/** Outward unit normal of a hex edge, in canonical space (+y down). */
function edgeDirection(edge: number): Point {
  const th = ((240 + 60 * edge) * Math.PI) / 180;
  return { x: Math.cos(th), y: Math.sin(th) };
}

/** Where the badge for a coastal edge should sit, in canonical space. */
export function badgeCanonical(hexIndex: number, edge: number, out = BADGE_OUT): Point {
  const c = HEX_CENTERS[hexIndex]!;
  const d = edgeDirection(edge);
  return { x: c.x + d.x * (APOTHEM + out), y: c.y + d.y * (APOTHEM + out) };
}

export interface BadgeBlob {
  /** Blob centroid in canonical board space. */
  point: Point;
  /** Area in working-resolution pixels, for diagnostics. */
  area: number;
}

/**
 * Blue sea: the most saturated thing on the board and unmistakably cyan.
 *
 * Deliberately a hand-written colour rule rather than a learned one. The sea is
 * the one region whose colour is fixed by the printing and not by the lighting,
 * so it survives the warm indoor shots and the glare shots alike.
 */
function seaMask(buf: PixelBuffer): boolean[] {
  const out = new Array<boolean>(buf.width * buf.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = buf.data[p]!, g = buf.data[p + 1]!, b = buf.data[p + 2]!;
    out[i] = b > r + 25 && b > 60 && g > r;
  }
  return out;
}

/** Pixels per canonical hex radius, under the given transform. */
function pixelsPerRadius(h: Matrix3): number {
  const a = applyHomography(h, { x: 0, y: 0 });
  const b = applyHomography(h, { x: 1, y: 0 });
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Cream blobs enclosed by sea, in canonical space.
 *
 * `toImage` maps canonical to this buffer's pixels; `toCanonical` is its
 * inverse. Both are passed in rather than derived so callers that already have
 * them (the live reader) do not solve the same system twice.
 */
export function findBadges(
  buf: PixelBuffer,
  toImage: Matrix3,
  toCanonical: Matrix3,
): BadgeBlob[] {
  const { width, height } = buf;
  const rpx = pixelsPerRadius(toImage);
  if (rpx <= 0) return [];

  const sea = seaMask(buf);

  // Mask the ISLAND out before looking for anything pale. Desert and the token
  // faces are as unsaturated as a harbour card; without this the board's own
  // middle produces more candidates than the sea does.
  const island = new Array<boolean>(width * height).fill(false);
  const discR = rpx * 1.02;
  for (const centre of HEX_CENTERS) {
    const p = applyHomography(toImage, centre);
    if (!p) continue;
    const x0 = Math.max(0, Math.floor(p.x - discR));
    const x1 = Math.min(width - 1, Math.ceil(p.x + discR));
    const y0 = Math.max(0, Math.floor(p.y - discR));
    const y1 = Math.min(height - 1, Math.ceil(p.y + discR));
    for (let y = y0; y <= y1; y++) {
      const dy = y - p.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x - p.x;
        if (dx * dx + dy * dy < discR * discR) island[y * width + x] = true;
      }
    }
  }

  const cream: boolean[] = new Array(width * height);
  for (let i = 0, p = 0; i < cream.length; i++, p += 4) {
    if (island[i]) {
      cream[i] = false;
      continue;
    }
    const r = buf.data[p]!, g = buf.data[p + 1]!, b = buf.data[p + 2]!;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    cream[i] = sat < 0.34 && mx / 255 > 0.42;
  }

  const mask: BinaryMask = { data: cream, width, height };
  const minArea = (rpx * 0.1) ** 2;
  const maxArea = (rpx * 0.85) ** 2;
  const out: BadgeBlob[] = [];

  for (const blob of connectedComponents(mask)) {
    if (blob.size < minArea || blob.size > maxArea) continue;

    /*
      THE ENCLOSURE TEST — the one that separates a badge from the tablecloth.

      Look at an annulus just outside the blob. A harbour card is an island in
      the sea, so most of its surroundings are blue. The cloth the board rests
      on is bounded by table, room, and hands, so it is not. Nothing about
      colour or size distinguishes the two; only what is AROUND them does.
    */
    const rad = Math.max(4, Math.round(Math.sqrt(blob.size / Math.PI)));
    const inner = rad * 1.4;
    const outer = rad * 2.4;
    let ringPixels = 0;
    let ringSea = 0;
    const x0 = Math.max(0, Math.floor(blob.cx - outer));
    const x1 = Math.min(width - 1, Math.ceil(blob.cx + outer));
    const y0 = Math.max(0, Math.floor(blob.cy - outer));
    const y1 = Math.min(height - 1, Math.ceil(blob.cy + outer));
    for (let y = y0; y <= y1; y++) {
      const dy = y - blob.cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - blob.cx;
        const d2 = dx * dx + dy * dy;
        if (d2 <= inner * inner || d2 >= outer * outer) continue;
        ringPixels++;
        if (sea[y * width + x]) ringSea++;
      }
    }
    if (ringPixels === 0 || ringSea / ringPixels <= 0.5) continue;

    const can = applyHomography(toCanonical, { x: blob.cx, y: blob.cy });
    if (can) out.push({ point: can, area: blob.size });
  }

  return out;
}

/**
 * Detection strength for EVERY coastal edge: 1 at the predicted spot, falling
 * to 0 at MATCH_RADIUS.
 *
 * Dense and graded on purpose, and this is the single most important choice in
 * the whole harbour path. A sparse map of confident hits leaves missed harbours
 * at exactly zero, and a harbour at exactly zero is unrecoverable whenever its
 * neighbours are 7 edges apart — six of the nine on the reference board. A
 * badge washed out by glare still scores a little above the empty water beside
 * it, and that little is enough. See the note on `selectRing`.
 */
export function harbourEvidence(badges: readonly BadgeBlob[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const slot of COASTAL_RING) {
    const q = badgeCanonical(slot.hexIndex, slot.edge);
    let best = Infinity;
    for (const b of badges) {
      const d = Math.hypot(b.point.x - q.x, b.point.y - q.y);
      if (d < best) best = d;
    }
    if (best < MATCH_RADIUS) {
      scores.set(edgeKey(slot.hexIndex, slot.edge), Math.max(0, 1 - best / MATCH_RADIUS));
    }
  }
  return scores;
}

export interface HarbourReading extends RingChoice {
  /** Raw blobs that survived the enclosure test, for diagnostics. */
  badges: BadgeBlob[];
  /** How many coastal edges got any evidence at all. */
  matched: number;
  /** What each chosen harbour trades, parallel to `slots`. */
  types: PortType[];
  /**
   * How much better the chosen labelling is than the next one.
   *
   * Separate from the position margin because the two can disagree: a photo can
   * pin the ring exactly and still be unsure whether a grey icon is ore or
   * wool. Reported so the UI can ask about types without casting doubt on
   * positions it actually read.
   */
  typeMargin: number;
}

/**
 * Read the nine harbour positions from a photo and four tapped corners.
 *
 * Positions only. Which RESOURCE each harbour trades is a separate problem with
 * its own constraint (the composition of the bag) and lives apart from this.
 */
export function readHarbours(
  buffer: PixelBuffer,
  guideCorners: readonly [Point, Point, Point, Point],
): HarbourReading | null {
  const factor = Math.max(
    1,
    Math.round(Math.max(buffer.width, buffer.height) / WORKING_MAX_DIM),
  );
  const small = downscale(buffer, factor);
  // Corners arrive in full-resolution pixels; move them onto the working buffer
  // so every transform below speaks one coordinate system.
  const scaled = guideCorners.map(c => ({ x: c.x / factor, y: c.y / factor })) as unknown as
    readonly [Point, Point, Point, Point];

  const toImage = solveHomography(CORNER_HEX_CENTERS, scaled);
  const toCanonical = solveHomography(scaled, CORNER_HEX_CENTERS);
  if (!toImage || !toCanonical) return null;

  const badges = findBadges(small, toImage, toCanonical);
  const scores = harbourEvidence(badges);
  const ring = selectRing(scores);

  /*
    Types, from the FULL-RESOLUTION buffer.

    Positions survive the downscale — a blob centroid is stable — but the icon
    on a harbour card does not. At the working resolution a sheaf of grain is a
    handful of pixels, and the features that separate it from a brick are gone.
    So the badge patches are sampled from the original photo.
  */
  const fullToImage = solveHomography(CORNER_HEX_CENTERS, guideCorners);
  const features = ring.slots.map(slot => {
    if (!fullToImage) return null;
    // Centre on the DETECTED card when there is one. The predicted spot is
    // right on average and off by up to a third of a radius on any one photo,
    // which is enough to clip the card or pull the neighbouring dock in — and a
    // contaminated patch is what every earlier attempt measured.
    const q = badgeCanonical(slot.hexIndex, slot.edge);
    let centre = q;
    let best = MATCH_RADIUS;
    for (const b of badges) {
      const d = Math.hypot(b.point.x - q.x, b.point.y - q.y);
      if (d < best) {
        best = d;
        centre = b.point;
      }
    }
    return cardFeatures(rectifyBadge(buffer, fullToImage, centre, slot.edge));
  });

  const assigned = assignTypes(features);
  return {
    ...ring,
    badges,
    matched: scores.size,
    types: assigned.types,
    typeMargin: assigned.margin,
  };
}

export type { RingSlot };

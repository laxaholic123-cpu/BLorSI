/**
 * Binary-image primitives: thresholding, connected components, hole counting.
 *
 * Pure — operates on plain arrays, no image decoding and no React Native, so
 * every one of these is unit-testable against hand-drawn bitmaps.
 *
 * These are what turn a token crop into the three counts tokenDecode needs.
 */

export interface BinaryMask {
  /** true = ink (foreground). */
  data: boolean[];
  width: number;
  height: number;
}

export interface GrayImage {
  /** 0–255 luminance, row-major. */
  data: Uint8Array | number[];
  width: number;
  height: number;
}

/**
 * Otsu's method — pick the threshold that best separates the histogram into two
 * classes.
 *
 * Chosen over a fixed threshold because board photos vary enormously in
 * exposure: the reference set includes shots under warm indoor light, direct
 * glare, and shadow. A fixed cut would work on some and fail on others.
 */
export function otsuThreshold(image: GrayImage): number {
  const histogram = new Array<number>(256).fill(0);
  const total = image.width * image.height;
  for (let i = 0; i < total; i++) histogram[image.data[i]! & 0xff]! += 1;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t]!;

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (between > bestVariance) {
      bestVariance = between;
      best = t;
    }
  }
  return best;
}

/** Threshold a grayscale image into ink/background. Ink is assumed darker. */
export function threshold(image: GrayImage, cut?: number): BinaryMask {
  const level = cut ?? otsuThreshold(image);
  const size = image.width * image.height;
  const data = new Array<boolean>(size);
  for (let i = 0; i < size; i++) data[i] = (image.data[i]! & 0xff) <= level;
  return { data, width: image.width, height: image.height };
}

/** A located disc within a crop, in crop pixel coordinates. */
export interface Disc {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * Find the token's bright face inside a crop.
 *
 * The decoder used to assume the face was centred and filled the crop. Measured
 * on a real capture, neither holds: the face is about 64% of the assumed radius
 * and sits up to half a radius off centre, because tokens are dropped on tiles
 * by hand and the crop is sized from a canonical constant rather than the
 * board in front of you.
 *
 * The cost of assuming was severe. Thresholding a crop that is mostly TILE
 * marks the tile as ink, hands the decoder one enormous blob as the "glyph",
 * and demotes the real digits to pips — which is why glyph counting sat at
 * chance and every two-digit token failed.
 *
 * Returns null rather than guessing when what it finds is not disc-like, runs
 * off the crop edge, or is an implausible size. A bright tile can look like a
 * face, and a wrong face is worse than no face.
 */
export function locateBrightDisc(image: GrayImage): Disc | null {
  const cut = otsuThreshold(image);
  const size = image.width * image.height;
  const bright = new Array<boolean>(size);
  for (let i = 0; i < size; i++) bright[i] = (image.data[i]! & 0xff) > cut;

  const comps = connectedComponents(
    { data: bright, width: image.width, height: image.height },
    true,
  );
  if (comps.length === 0) return null;

  let big = comps[0]!;
  for (const c of comps) if (c.size > big.size) big = c;

  const w = big.maxX - big.minX + 1;
  const h = big.maxY - big.minY + 1;
  // A face is round. Anything markedly oblong is scenery.
  if (Math.min(w, h) / Math.max(w, h) < 0.72) return null;
  // Touching the edge means the bright region continued into the tile.
  if (big.minX <= 0 || big.minY <= 0 ||
      big.maxX >= image.width - 1 || big.maxY >= image.height - 1) return null;

  const half = Math.min(image.width, image.height) / 2;
  const radius = Math.max(w, h) / 2;
  if (radius < half * 0.30 || radius > half * 0.98) return null;

  return { cx: (big.minX + big.maxX) / 2, cy: (big.minY + big.maxY) / 2, radius };
}

/** Clear everything outside a given disc. */
export function maskToDisc(mask: BinaryMask, disc: Disc): BinaryMask {
  const r2 = disc.radius * disc.radius;
  const data = new Array<boolean>(mask.data.length);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const i = y * mask.width + x;
      const dx = x - disc.cx;
      const dy = y - disc.cy;
      data[i] = dx * dx + dy * dy <= r2 ? mask.data[i]! : false;
    }
  }
  return { data, width: mask.width, height: mask.height };
}

/**
 * Otsu over one disc only.
 *
 * The cut must come from the token face alone. Tile artwork in the crop drags
 * the split away from the cream-versus-ink boundary the decoder depends on, and
 * on textured terrain that alone took tokens to 0/30 correct.
 */
export function otsuThresholdInDisc(image: GrayImage, disc: Disc): number {
  const r2 = disc.radius * disc.radius;
  const inside: number[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const dx = x - disc.cx;
      const dy = y - disc.cy;
      if (dx * dx + dy * dy <= r2) inside.push(image.data[y * image.width + x]! & 0xff);
    }
  }
  if (inside.length === 0) return otsuThreshold(image);
  return otsuThreshold({ data: Uint8Array.from(inside), width: inside.length, height: 1 });
}

/** The centred disc to fall back on when the face cannot be found. */
export function fallbackDisc(size: number): Disc {
  // 0.65 rather than 1.0: measured, the face is about 64% of the assumed radius.
  return { cx: (size - 1) / 2, cy: (size - 1) / 2, radius: (size / 2) * 0.65 };
}

export interface Component {
  /** Pixel indices belonging to this component. */
  size: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Centroid, in pixels. */
  cx: number;
  cy: number;
}

/**
 * Label connected regions using 4-connectivity, via an explicit stack.
 *
 * `target` selects which value is being grouped: true for ink components,
 * false for background — which is how holes are found.
 *
 * Iterative rather than recursive on purpose: a token crop is small, but a
 * recursive flood fill over a few thousand connected pixels will blow the JS
 * stack on some engines, and this runs on a phone.
 */
export function connectedComponents(mask: BinaryMask, target = true): Component[] {
  const { data, width, height } = mask;
  const seen = new Array<boolean>(width * height).fill(false);
  const components: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < data.length; start++) {
    if (seen[start] || data[start] !== target) continue;

    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    stack.push(start);
    seen[start] = true;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;

      size += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const n = index - 1;
        if (!seen[n] && data[n] === target) { seen[n] = true; stack.push(n); }
      }
      if (x < width - 1) {
        const n = index + 1;
        if (!seen[n] && data[n] === target) { seen[n] = true; stack.push(n); }
      }
      if (y > 0) {
        const n = index - width;
        if (!seen[n] && data[n] === target) { seen[n] = true; stack.push(n); }
      }
      if (y < height - 1) {
        const n = index + width;
        if (!seen[n] && data[n] === target) { seen[n] = true; stack.push(n); }
      }
    }

    components.push({
      size,
      minX, minY, maxX, maxY,
      cx: sumX / size,
      cy: sumY / size,
    });
  }

  return components;
}

/**
 * Count enclosed background regions — the holes in the ink.
 *
 * Background touching the image border is the outside world, not a hole, so it
 * is excluded. That single rule is what makes this the Euler number: 5 has no
 * enclosed region, 6 and 9 and 0 have one, 8 has two.
 */
export function countHoles(mask: BinaryMask): number {
  const background = connectedComponents(mask, false);
  return background.filter(
    c => c.minX > 0 && c.minY > 0 && c.maxX < mask.width - 1 && c.maxY < mask.height - 1,
  ).length;
}

/**
 * Drop components too small to be real ink — speckle from sensor noise, JPEG
 * artefacts, or the printed texture of the token itself.
 */
export function filterNoise(components: Component[], minSize: number): Component[] {
  return components.filter(c => c.size >= minSize);
}

/**
 * Split a token's ink into the digits and the pips beneath them.
 *
 * Pips are markedly smaller than digits, so a size cut separates them cleanly
 * without needing to know which way up the token is: the split is on area, not
 * position. Returned as-is when the caller wants to inspect them.
 */
export function splitGlyphsAndPips(
  components: Component[],
): { glyphs: Component[]; pips: Component[] } {
  if (components.length === 0) return { glyphs: [], pips: [] };

  const largest = Math.max(...components.map(c => c.size));
  // A pip is a solid dot roughly a tenth the area of a digit. Half the largest
  // component is a wide margin that still separates them reliably.
  const cut = largest * 0.5;
  return {
    glyphs: components.filter(c => c.size >= cut),
    pips: components.filter(c => c.size < cut),
  };
}

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

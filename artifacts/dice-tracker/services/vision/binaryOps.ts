/**
 * Binary primitives for reading a token crop.
 *
 * Once a much larger module. Everything that supported the pip/glyph/hole
 * decoder was removed when that approach was replaced by digit-shape matching
 * — including `locateBrightDisc`, which found the token face by BRIGHTNESS and
 * silently failed on bright tiles for weeks before anyone counted how often it
 * matched. It is gone rather than deprecated so it cannot be reached for again.
 *
 * What remains is what `digitSample` actually uses: an Otsu cut measured inside
 * the token's disc rather than across the square crop, and connected-component
 * labelling to separate the numeral from the tile around it.
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


/** A located disc within a crop, in crop pixel coordinates. */
export interface Disc {
  cx: number;
  cy: number;
  radius: number;
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




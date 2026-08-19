/**
 * Perspective transform between canonical board space and photo pixels.
 *
 * Pure maths — no image data, no React Native, fully unit-testable.
 *
 * WHY A HOMOGRAPHY
 * ----------------
 * Finding a Catan board in an arbitrary photo is the hardest part of reading
 * one, and it is almost entirely avoidable. A board is planar and rigid, so four
 * known point correspondences pin down the entire mapping between the board and
 * the image — including perspective, rotation, and scale. Ask the player to
 * identify four points (or detect them, and let the player correct), and every
 * one of the 19 hex centres and 19 token circles becomes a known pixel location.
 *
 * The four points we use are the centres of the four corner tiles, which form a
 * rectangle in canonical space (see boardGeometry). That makes this the standard
 * perspective-correction case and keeps the instruction simple: "tap the middle
 * of each corner tile."
 */

export interface Point {
  x: number;
  y: number;
}

/** Row-major 3x3 matrix. */
export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Solve a dense linear system by Gaussian elimination with partial pivoting.
 * Returns null when the system is singular — which for our purposes means the
 * four points were collinear or coincident, i.e. the taps were not a real quad.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-10) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];

    const pivotVal = m[col]![col]!;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row]![col]! / pivotVal;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) {
        m[row]![k] = m[row]![k]! - factor * m[col]![k]!;
      }
    }
  }

  return Array.from({ length: n }, (_, i) => m[i]![n]! / m[i]![i]!);
}

/**
 * Homography mapping four source points onto four destination points.
 *
 * Solves the standard 8-unknown DLT system with h33 fixed at 1. Returns null if
 * the correspondence is degenerate.
 */
export function solveHomography(
  src: readonly [Point, Point, Point, Point],
  dst: readonly [Point, Point, Point, Point],
): Matrix3 | null {
  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(a, b);
  if (!h) return null;
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

/** Map a point through a homography. Returns null if it lands on the horizon. */
export function applyHomography(h: Matrix3, p: Point): Point | null {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Map many points at once, dropping any that are degenerate. */
export function applyHomographyAll(h: Matrix3, points: readonly Point[]): (Point | null)[] {
  return points.map(p => applyHomography(h, p));
}

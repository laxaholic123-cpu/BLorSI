/**
 * Turning and correcting the harbour ring.
 *
 * WHY THIS EXISTS, AND WHY ROTATION IS THE WHOLE FEATURE
 * -----------------------------------------------------
 * `STANDARD_PORT_LAYOUT` is a real transcription from a real board, and it is
 * still wrong for most games — because the frame's rotation relative to the
 * app's hex indexing is arbitrary. The tiles get reshuffled every game while
 * the frame stays assembled, and the app's hex numbering comes from whichever
 * corner the player taps first. Nothing anchors one to the other.
 *
 * Measured, on two captures of a real board (`tools/port_probe.py`):
 *
 *     rotation applied      mean distance from the detected badges
 *       0 deg                 1.50 hex radii
 *      60 deg                 0.23
 *     120 deg                 1.50
 *     180 deg                 0.23
 *     240 deg                 1.50
 *     300 deg                 0.23
 *
 * The harbours are all correct RELATIVE TO EACH OTHER — nine positions, right
 * spacing, right types in the right order. Only the anchoring is off. So the
 * fix a player needs is not an editor with nine rows; it is a single control
 * that turns the whole ring until it matches the board in front of them.
 *
 * (The three-way tie at 60/180/300 is real and expected: the POSITION set has
 * 3-fold symmetry, so positions alone cannot pick between those three. The
 * types break the tie, and a player can see the types.)
 *
 * Individual editing exists too, for a frame that genuinely differs between
 * editions — but rotation is what fixes the common case in one tap.
 */

import {
  HEX_AXIAL,
  PORT_TYPE_COUNTS,
  axialToIndex,
  validatePortLayout,
} from '@/services/catanBoard';
import type { CatanPortDef, HexEdge, PortType } from '@/types/models';

/** Number of distinct rotations of a hexagonal board. */
export const ROTATION_STEPS = 6;

/**
 * Rotate one hex index by 60 degrees clockwise, `steps` times.
 *
 * Axial rotation by 60 deg CW is (q, r) -> (-r, q + r). Applied to the board's
 * own coordinates rather than to screen positions, so it stays exact — no
 * trigonometry, no rounding, and a full six steps returns the identity.
 */
export function rotateHexIndex(hexIndex: number, steps: number): number {
  const start = HEX_AXIAL[hexIndex];
  if (!start) return hexIndex;
  let { q, r } = start;
  const n = ((steps % ROTATION_STEPS) + ROTATION_STEPS) % ROTATION_STEPS;
  for (let i = 0; i < n; i++) {
    const nq = -r;
    const nr = q + r;
    q = nq;
    r = nr;
  }
  return axialToIndex(q, r) ?? hexIndex;
}

/** Rotate an edge the same way: one step clockwise moves NW to NE. */
export function rotateEdge(edge: HexEdge, steps: number): HexEdge {
  const n = ((steps % ROTATION_STEPS) + ROTATION_STEPS) % ROTATION_STEPS;
  return (((edge + n) % ROTATION_STEPS) as HexEdge);
}

/**
 * Turn the whole harbour ring, keeping every type where it is relative to the
 * others.
 *
 * The composition is preserved by construction — this permutes positions and
 * never touches types — so a rotated layout is still four 3:1s and one 2:1 per
 * resource, and `validatePortLayout` will still pass.
 */
export function rotatePortLayout(
  ports: readonly CatanPortDef[],
  steps: number,
): CatanPortDef[] {
  return ports.map(p => ({
    hexIndex: rotateHexIndex(p.hexIndex, steps),
    edge: rotateEdge(p.edge, steps),
    type: p.type,
  }));
}

/**
 * Replace one harbour's type, moving the displaced type to whichever harbour
 * currently holds the one being taken.
 *
 * A straight assignment would break the composition — set two harbours to
 * `ore` and the board has two ore ports and no wool, which
 * `validatePortLayout` rejects and which cannot exist in the box. Swapping
 * keeps the bag intact, so every edit lands on a legal board. That is the same
 * constraint the token bag enforces for numbers.
 */
export function setPortType(
  ports: readonly CatanPortDef[],
  index: number,
  type: PortType,
): CatanPortDef[] {
  const target = ports[index];
  if (!target || target.type === type) return [...ports];

  // Generic is the one type with several copies, so a swap needs a partner
  // only when one exists to take the displaced type.
  const partner = ports.findIndex((p, i) => i !== index && p.type === type);
  return ports.map((p, i) => {
    if (i === index) return { ...p, type };
    if (i === partner) return { ...p, type: target.type };
    return { ...p };
  });
}

export interface PortRingProblem {
  message: string;
}

/**
 * Check a ring the player has edited.
 *
 * Delegates to `validatePortLayout`, which was written independently of any of
 * this and already knows the geometry and the component counts.
 */
export function checkPortRing(ports: readonly CatanPortDef[]): PortRingProblem[] {
  return validatePortLayout(ports).map(p => ({ message: p.message }));
}

/** Every type a harbour can be, in a stable order for a picker. */
export const PORT_TYPE_ORDER: readonly PortType[] = Object.keys(
  PORT_TYPE_COUNTS,
) as PortType[];

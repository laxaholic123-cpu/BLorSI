/**
 * Turning the harbour ring.
 *
 * The properties that matter are algebraic — six rotations return the board to
 * itself, rotation never invents or destroys a harbour, and no edit can produce
 * a ring that could not come out of the box. Those hold for every board, which
 * is why they are worth testing rather than a handful of examples.
 */

import {
  PORT_TYPE_ORDER,
  ROTATION_STEPS,
  checkPortRing,
  rotateEdge,
  rotateHexIndex,
  rotatePortLayout,
  setPortType,
} from '@/services/catanPorts';
import {
  HEX_COUNT,
  PORT_TYPE_COUNTS,
  STANDARD_PORT_LAYOUT,
  isCoastalEdge,
} from '@/services/catanBoard';
import type { HexEdge } from '@/types/models';

describe('rotateHexIndex', () => {
  it('returns to the identity after six steps, for every hex', () => {
    for (let i = 0; i < HEX_COUNT; i++) {
      expect(rotateHexIndex(i, ROTATION_STEPS)).toBe(i);
    }
  });

  it('is a permutation at every step — nothing is lost or duplicated', () => {
    for (let steps = 0; steps < ROTATION_STEPS; steps++) {
      const mapped = new Set(
        Array.from({ length: HEX_COUNT }, (_, i) => rotateHexIndex(i, steps)),
      );
      expect(mapped.size).toBe(HEX_COUNT);
    }
  });

  it('leaves the centre hex alone', () => {
    // Hex 9 is the middle of the 3-4-5-4-3 layout; rotation fixes it.
    for (let steps = 0; steps < ROTATION_STEPS; steps++) {
      expect(rotateHexIndex(9, steps)).toBe(9);
    }
  });

  it('walks the six corner hexes round one another', () => {
    // The outer corners form a single 6-cycle under 60-degree rotation.
    const corners = [0, 2, 11, 18, 16, 7];
    for (const c of corners) {
      const seen = new Set<number>();
      for (let s = 0; s < ROTATION_STEPS; s++) seen.add(rotateHexIndex(c, s));
      expect([...seen].sort((a, b) => a - b)).toEqual([...corners].sort((a, b) => a - b));
    }
  });

  it('handles negative and oversized step counts', () => {
    for (let i = 0; i < HEX_COUNT; i++) {
      expect(rotateHexIndex(i, -1)).toBe(rotateHexIndex(i, 5));
      expect(rotateHexIndex(i, 13)).toBe(rotateHexIndex(i, 1));
    }
  });
});

describe('rotateEdge', () => {
  it('cycles through all six and returns', () => {
    for (let e = 0; e < 6; e++) {
      expect(rotateEdge(e as HexEdge, ROTATION_STEPS)).toBe(e);
    }
  });

  it('moves NW to NE in one clockwise step', () => {
    expect(rotateEdge(0, 1)).toBe(1);
    expect(rotateEdge(5, 1)).toBe(0);
  });
});

describe('rotatePortLayout', () => {
  it('keeps every harbour on a coastal edge, at every rotation', () => {
    // The real test of the rotation maths: an off-by-one in the edge mapping
    // would put a harbour against an inland face, which cannot exist.
    for (let steps = 0; steps < ROTATION_STEPS; steps++) {
      const rotated = rotatePortLayout(STANDARD_PORT_LAYOUT, steps);
      for (const p of rotated) {
        expect(isCoastalEdge(p.hexIndex, p.edge)).toBe(true);
      }
    }
  });

  it('produces a layout that still validates, at every rotation', () => {
    for (let steps = 0; steps < ROTATION_STEPS; steps++) {
      expect(checkPortRing(rotatePortLayout(STANDARD_PORT_LAYOUT, steps))).toEqual([]);
    }
  });

  it('preserves the composition exactly', () => {
    for (let steps = 0; steps < ROTATION_STEPS; steps++) {
      const counts = new Map<string, number>();
      for (const p of rotatePortLayout(STANDARD_PORT_LAYOUT, steps)) {
        counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
      }
      for (const [type, expected] of Object.entries(PORT_TYPE_COUNTS)) {
        expect(counts.get(type) ?? 0).toBe(expected);
      }
    }
  });

  it('returns the original layout after six steps', () => {
    const back = rotatePortLayout(STANDARD_PORT_LAYOUT, ROTATION_STEPS);
    expect(back).toEqual([...STANDARD_PORT_LAYOUT]);
  });

  it('actually moves things — a rotation is not a no-op', () => {
    const one = rotatePortLayout(STANDARD_PORT_LAYOUT, 1);
    expect(one).not.toEqual([...STANDARD_PORT_LAYOUT]);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(STANDARD_PORT_LAYOUT);
    rotatePortLayout(STANDARD_PORT_LAYOUT, 3);
    expect(JSON.stringify(STANDARD_PORT_LAYOUT)).toBe(before);
  });
});

describe('setPortType', () => {
  it('SWAPS rather than overwrites, so the bag stays intact', () => {
    // Overwriting would give a board two ore ports and no wool — a ring that
    // cannot come out of the box, and which validatePortLayout rejects.
    const oreIndex = STANDARD_PORT_LAYOUT.findIndex(p => p.type === 'ore');
    const woolIndex = STANDARD_PORT_LAYOUT.findIndex(p => p.type === 'wool');
    const next = setPortType(STANDARD_PORT_LAYOUT, oreIndex, 'wool');
    expect(next[oreIndex]!.type).toBe('wool');
    expect(next[woolIndex]!.type).toBe('ore');
    expect(checkPortRing(next)).toEqual([]);
  });

  it('keeps the ring legal for every type applied to every position', () => {
    for (let i = 0; i < STANDARD_PORT_LAYOUT.length; i++) {
      for (const type of PORT_TYPE_ORDER) {
        expect(checkPortRing(setPortType(STANDARD_PORT_LAYOUT, i, type))).toEqual([]);
      }
    }
  });

  it('is a no-op when the type already matches', () => {
    const i = 0;
    const same = setPortType(STANDARD_PORT_LAYOUT, i, STANDARD_PORT_LAYOUT[i]!.type);
    expect(same).toEqual([...STANDARD_PORT_LAYOUT]);
  });

  it('never moves a harbour off its edge', () => {
    const next = setPortType(STANDARD_PORT_LAYOUT, 2, 'ore');
    for (let i = 0; i < next.length; i++) {
      expect(next[i]!.hexIndex).toBe(STANDARD_PORT_LAYOUT[i]!.hexIndex);
      expect(next[i]!.edge).toBe(STANDARD_PORT_LAYOUT[i]!.edge);
    }
  });

  it('ignores an out-of-range index', () => {
    expect(setPortType(STANDARD_PORT_LAYOUT, 99, 'ore')).toEqual([...STANDARD_PORT_LAYOUT]);
  });
});

describe('rotation composes', () => {
  it('two steps then three equals five', () => {
    const a = rotatePortLayout(rotatePortLayout(STANDARD_PORT_LAYOUT, 2), 3);
    const b = rotatePortLayout(STANDARD_PORT_LAYOUT, 5);
    expect(a).toEqual(b);
  });
});

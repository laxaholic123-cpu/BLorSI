/**
 * Turning detected harbour positions into a port layout.
 *
 * The job this does is narrow but easy to get subtly wrong: the positions are
 * read from the photo and must survive untouched, while the types are a
 * proposal that has to stay a LEGAL bag no matter how it is shifted.
 */

import { portsFromDetectedSlots, setPortType, shiftPortTypes } from '@/services/catanPorts';
import {
  PORT_COUNT,
  PORT_TYPE_COUNTS,
  STANDARD_PORT_LAYOUT,
  getCoastalEdgesClockwise,
  isCoastalEdge,
  validatePortLayout,
} from '@/services/catanBoard';
import type { HexEdge, PortType } from '@/types/models';

/** A shuffled frame: nine legal positions that are NOT the standard ones. */
const ring = getCoastalEdgesClockwise();
const SHIFTED = [0, 3, 7, 10, 13, 17, 20, 23, 27].map(i => ({
  hexIndex: ring[i]!.hexIndex,
  edge: ring[i]!.edge as HexEdge,
}));

const STANDARD = STANDARD_PORT_LAYOUT.map(p => ({ hexIndex: p.hexIndex, edge: p.edge }));

const tally = (types: PortType[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
};

describe('portsFromDetectedSlots', () => {
  it('keeps the DETECTED positions exactly, on a shuffled frame', () => {
    // The whole point. A rotation control cannot express this board at all,
    // which is why it had to go.
    const ports = portsFromDetectedSlots(SHIFTED);
    expect(ports).toHaveLength(PORT_COUNT);
    const got = ports.map(p => `${p.hexIndex}:${p.edge}`).sort();
    expect(got).toEqual(SHIFTED.map(s => `${s.hexIndex}:${s.edge}`).sort());
  });

  it('produces a legal board from the standard positions', () => {
    expect(validatePortLayout(portsFromDetectedSlots(STANDARD))).toEqual([]);
  });

  it('keeps the BAG intact at every phase', () => {
    /*
      Four 3:1 and one of each resource, whatever the phase. Shifting must
      permute the labels, never reprint them — a phase that produced two ore
      harbours would be a board that cannot exist in the box.
    */
    const want = tally(STANDARD_PORT_LAYOUT.map(p => p.type));
    for (let phase = 0; phase < PORT_COUNT; phase++) {
      const ports = portsFromDetectedSlots(SHIFTED, phase);
      expect(tally(ports.map(p => p.type))).toEqual(want);
    }
    // And that bag is the one the rules define, not just a self-consistent one.
    expect(want.generic).toBe(PORT_TYPE_COUNTS.generic);
  });

  it('gives every phase a DIFFERENT arrangement', () => {
    // Nine phases that silently collapsed to three would leave arrangements the
    // player could never reach, and the control would look broken for no
    // visible reason.
    const seen = new Set<string>();
    for (let phase = 0; phase < PORT_COUNT; phase++) {
      seen.add(portsFromDetectedSlots(SHIFTED, phase).map(p => p.type).join(','));
    }
    expect(seen.size).toBe(PORT_COUNT);
  });

  it('places every harbour on an edge that faces the sea', () => {
    for (const p of portsFromDetectedSlots(SHIFTED)) {
      expect(isCoastalEdge(p.hexIndex, p.edge)).toBe(true);
    }
  });

  it('reproduces the standard layout exactly, at the right phase', () => {
    // An unshuffled frame should come back as the board in the rulebook at one
    // of the phases; if none matched, the ring ordering would be wrong.
    const want = [...STANDARD_PORT_LAYOUT]
      .map(p => `${p.hexIndex}:${p.edge}:${p.type}`)
      .sort()
      .join('|');
    const phases = Array.from({ length: PORT_COUNT }, (_, phase) =>
      portsFromDetectedSlots(STANDARD, phase)
        .map(p => `${p.hexIndex}:${p.edge}:${p.type}`)
        .sort()
        .join('|'),
    );
    expect(phases).toContain(want);
  });

  it('handles a negative phase without falling off the array', () => {
    const ports = portsFromDetectedSlots(SHIFTED, -1);
    expect(ports).toHaveLength(PORT_COUNT);
    expect(ports.every(p => typeof p.type === 'string')).toBe(true);
  });
});

describe('shiftPortTypes', () => {
  const base = portsFromDetectedSlots(SHIFTED);

  it('moves the labels but never the positions', () => {
    const after = shiftPortTypes(base);
    expect(after.map(p => `${p.hexIndex}:${p.edge}`)).toEqual(
      base.map(p => `${p.hexIndex}:${p.edge}`),
    );
    expect(after.map(p => p.type)).not.toEqual(base.map(p => p.type));
  });

  it('returns to the start after nine shifts', () => {
    let cur = base;
    for (let i = 0; i < PORT_COUNT; i++) cur = shiftPortTypes(cur);
    expect(cur.map(p => p.type)).toEqual(base.map(p => p.type));
  });

  it('keeps the bag legal through every shift', () => {
    let cur = base;
    for (let i = 0; i < PORT_COUNT; i++) {
      cur = shiftPortTypes(cur);
      expect(validatePortLayout(cur)).toEqual([]);
    }
  });

  it('STILL SHIFTS after the player has corrected a harbour', () => {
    /*
      The regression this design exists to prevent. Correcting one harbour
      swaps a second, so an earlier version recorded all nine as player-set and
      the shift control quietly stopped doing anything — no error, no visible
      cause, just a button that had died. Exactly the shape of failure this
      project keeps hitting: a predicate that silently stops firing.
    */
    const corrected = setPortType(base, 0, 'ore');
    const after = shiftPortTypes(corrected);
    expect(after.map(p => p.type)).not.toEqual(corrected.map(p => p.type));
    expect(validatePortLayout(after)).toEqual([]);
  });

  it('shifts in both directions', () => {
    expect(shiftPortTypes(shiftPortTypes(base, 1), -1).map(p => p.type))
      .toEqual(base.map(p => p.type));
  });
});

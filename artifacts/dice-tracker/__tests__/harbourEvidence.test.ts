/**
 * Harbours build up across shots instead of the last shot winning.
 *
 * Before this, each shot re-read the harbours from scratch, so a second photo
 * taken to fix two tiles could quietly make the harbours worse. Tiles never
 * had that problem because their evidence merges; these tests pin the same
 * property for harbours.
 */

import { PORT_COUNT } from '@/services/catanBoard';
import {
  emptyHarbourEvidence,
  evidenceFromReading,
  mergeHarbourEvidence,
  resolveHarbours,
} from '@/services/vision/harbourEvidence';
import { COASTAL_RING, MIN_FRAME_MARGIN, edgeKey, framePositionSets } from '@/services/vision/harbourRing';
import { PORT_SLOTS, TYPE_PROFILES, assignTypes } from '@/services/vision/harbourTypes';

/** The reference board, read off ten captures. */
const TRUTH: [number, number][] = [
  [0, 0], [1, 1], [3, 5], [6, 1], [11, 2], [12, 5], [15, 3], [16, 4], [17, 3],
];
const TRUTH_KEYS = TRUTH.map(([h, e]) => `${h}:${e}`).sort();
const keys = (slots: { hexIndex: number; edge: number }[]) =>
  slots.map(s => `${s.hexIndex}:${s.edge}`).sort();

const truthSlots = TRUTH.map(([hexIndex, edge]) => COASTAL_RING.find(
  s => s.hexIndex === hexIndex && s.edge === edge,
)!);

/** A shot that saw the given edges at the given strength, with given card features. */
function shot(
  seen: [number, number][],
  strength: number,
  features: (number[] | null)[] = truthSlots.map(() => null),
) {
  return evidenceFromReading({
    edgeScores: new Map(seen.map(([h, e]) => [edgeKey(h, e), strength])),
    slots: truthSlots,
    features,
  });
}

describe('harbour evidence across shots', () => {
  it('has nothing to say before a shot', () => {
    expect(resolveHarbours(emptyHarbourEvidence())).toBeNull();
  });

  it('reads one good shot the same way a single read does', () => {
    const got = resolveHarbours(mergeHarbourEvidence(emptyHarbourEvidence(), shot(TRUTH, 1)))!;
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('CONFIRMS from two weak shots that neither could confirm alone', () => {
    /*
      The point of shooting again. Under glare a shot may find only a couple of
      badges, not enough margin to claim the frame. A second shot from a
      slightly different position finds a couple of others, and together they
      settle it.
    */
    const first = shot(TRUTH.slice(0, 1), 1.5);
    const second = shot(TRUTH.slice(4, 5), 1.5);
    expect(resolveHarbours(first)!.unsure).toHaveLength(PORT_COUNT);
    expect(resolveHarbours(second)!.unsure).toHaveLength(PORT_COUNT);

    const together = resolveHarbours(mergeHarbourEvidence(first, second))!;
    expect(together.margin).toBeGreaterThanOrEqual(MIN_FRAME_MARGIN);
    expect(together.unsure).toEqual([]);
    expect(keys(together.slots)).toEqual(TRUTH_KEYS);
  });

  it('is not undone by a later shot that found nothing', () => {
    // The old behaviour: the last shot won, so a blank second shot erased the
    // harbours the first had read.
    const good = shot(TRUTH, 1);
    const blank = shot([], 0);
    const got = resolveHarbours(mergeHarbourEvidence(good, blank))!;
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('lets agreement outweigh a single shot that pointed at the other set', () => {
    const other = framePositionSets()
      .map(set => set.map(p => COASTAL_RING[p]!))
      .find(slots => keys(slots).join() !== TRUTH_KEYS.join())!;
    const wrong = shot(other.slice(0, 4).map(s => [s.hexIndex, s.edge] as [number, number]), 1);
    const right1 = shot(TRUTH, 1);
    const right2 = shot(TRUTH, 1);
    const got = resolveHarbours(
      [right1, wrong, right2].reduce(mergeHarbourEvidence, emptyHarbourEvidence()),
    )!;
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
  });

  it('AVERAGES card features, so one washed-out card is outvoted, not added', () => {
    const clean = PORT_SLOTS.map(t => [...TYPE_PROFILES[t]!]);
    const washed = clean.map(f => f.map(v => v * 0.2));
    const a = shot(TRUTH, 1, clean);
    const b = shot(TRUTH, 1, washed);
    const merged = mergeHarbourEvidence(a, b);
    const key = edgeKey(truthSlots[0]!.hexIndex, truthSlots[0]!.edge);
    expect(merged.featureCounts[key]).toBe(2);
    const averaged = merged.featureSums[key]!.map(v => v / 2);
    averaged.forEach((v, k) => expect(v).toBeCloseTo((clean[0]![k]! + washed[0]![k]!) / 2, 10));
  });

  it('ignores a card that one shot could not describe', () => {
    // A declined card contributes nothing, rather than dragging the average to
    // zero and turning a clear harbour into a guess.
    const clean = PORT_SLOTS.map(t => [...TYPE_PROFILES[t]!]);
    const declined = clean.map(() => null);
    const merged = mergeHarbourEvidence(shot(TRUTH, 1, clean), shot(TRUTH, 1, declined));
    const key = edgeKey(truthSlots[3]!.hexIndex, truthSlots[3]!.edge);
    expect(merged.featureCounts[key]).toBe(1);
    expect(merged.featureSums[key]).toEqual(clean[3]);
  });

  it('types the merged board from the averaged features', () => {
    const clean = PORT_SLOTS.map(t => [...TYPE_PROFILES[t]!]);
    const got = resolveHarbours(mergeHarbourEvidence(shot(TRUTH, 1, clean), shot(TRUTH, 1, clean)))!;
    // Same answer as assigning the features directly, in slot order.
    const bySlot = got.slots.map(s => {
      const i = truthSlots.findIndex(t => t.hexIndex === s.hexIndex && t.edge === s.edge);
      return clean[i]!;
    });
    expect(got.types).toEqual(assignTypes(bySlot).types);
  });

  it('does not modify the evidence it merges', () => {
    const a = shot(TRUTH, 1);
    const before = JSON.stringify(a);
    mergeHarbourEvidence(a, shot(TRUTH, 1));
    expect(JSON.stringify(a)).toBe(before);
  });
});

/**
 * Multi-capture evidence accumulation.
 *
 * The property that matters throughout: looking again must never make the board
 * worse. A second capture can only add information, so every test here is really
 * asking "did this stay monotonic?"
 */

import {
  BOARD_REGIONS,
  CONFIDENCE_THRESHOLD,
  emptyEvidence,
  evidenceConfidence,
  guidanceForEvidence,
  hexConfidence,
  mergeEvidence,
} from '@/services/vision/evidenceMerge';
import {
  BOARD_HEX_COUNT,
  reconcileBoardFromEvidence,
  validateBoardComposition,
  type HexEvidence,
} from '@/services/boardConstraints';

const decisive = { grain: 2, wool: 30, lumber: 28, brick: 26, ore: 24, desert: 22 };
const ambiguous = { grain: 20, wool: 21, lumber: 22, brick: 40, ore: 41, desert: 42 };

describe('hexConfidence', () => {
  it('is high when one candidate clearly wins', () => {
    expect(hexConfidence(decisive)).toBeGreaterThan(0.8);
  });

  it('is low when the top two are neck and neck', () => {
    // This is exactly the tile worth photographing again.
    expect(hexConfidence(ambiguous)).toBeLessThan(0.2);
  });

  it('is zero when there is no opinion at all', () => {
    expect(hexConfidence({})).toBe(0);
    expect(hexConfidence({ grain: 5 })).toBe(0);
  });

  it('reflects the margin, not the absolute cost', () => {
    // Both readings are poor in absolute terms, but one is decisive.
    const far = { a: 100, b: 500 };
    const near = { a: 100, b: 105 };
    expect(hexConfidence(far)).toBeGreaterThan(hexConfidence(near));
  });
});

describe('evidenceConfidence', () => {
  const base = (over: Partial<HexEvidence> = {}): HexEvidence => ({
    index: 0,
    resourceCost: decisive,
    tokenCost: { 8: 2, 6: 25, 9: 30 },
    ...over,
  });

  it('is high when both the terrain and the token are clear', () => {
    expect(evidenceConfidence(base())).toBeGreaterThan(0.8);
  });

  it('is dragged down by whichever half is weaker', () => {
    // A tile whose colour is obvious but whose token is unreadable is not a
    // finished tile.
    expect(evidenceConfidence(base({ tokenCost: { 8: 20, 6: 21 } }))).toBeLessThan(0.2);
  });

  it('does not penalise the desert for having no token', () => {
    const desert = base({ hasToken: false, tokenCost: {} });
    expect(evidenceConfidence(desert)).toBeGreaterThan(0.8);
  });

  it('discounts a hex whose token was never looked at', () => {
    const unseen = base({ tokenCost: {} });
    expect(evidenceConfidence(unseen)).toBeLessThan(evidenceConfidence(base()));
  });
});

describe('mergeEvidence', () => {
  it('leaves a hex alone when the new capture saw nothing of it', () => {
    const first = emptyEvidence();
    first[3]!.resourceCost = { ...decisive };
    const merged = mergeEvidence(first, emptyEvidence());
    expect(merged[3]!.resourceCost).toEqual(decisive);
  });

  it('compounds agreement between two captures', () => {
    // Two independent looks that both favour grain make grain twice as cheap.
    const a = emptyEvidence();
    const b = emptyEvidence();
    a[0]!.resourceCost = { grain: 3, wool: 20 };
    b[0]!.resourceCost = { grain: 4, wool: 22 };
    const merged = mergeEvidence(a, b);
    expect(merged[0]!.resourceCost.grain).toBe(7);
    expect(merged[0]!.resourceCost.wool).toBe(42);
    expect(hexConfidence(merged[0]!.resourceCost)).toBeGreaterThan(0.8);
  });

  it('leaves a disagreement unresolved for the constraint solver', () => {
    const a = emptyEvidence();
    const b = emptyEvidence();
    a[0]!.resourceCost = { grain: 2, wool: 30 };
    b[0]!.resourceCost = { grain: 30, wool: 2 };
    const merged = mergeEvidence(a, b);
    // Neither candidate runs away with it — which is the honest outcome.
    expect(hexConfidence(merged[0]!.resourceCost)).toBeLessThan(0.2);
  });

  it('never lets a blank capture dilute a clear one', () => {
    // The whole premise of re-capturing is that looking again cannot hurt.
    const first = emptyEvidence();
    first[5]!.resourceCost = { ...decisive };
    const before = hexConfidence(first[5]!.resourceCost);
    const after = hexConfidence(mergeEvidence(first, emptyEvidence())[5]!.resourceCost);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('remembers a token seen in any capture', () => {
    // Glare hides tokens; it never invents them. So one sighting is decisive
    // and a later miss must not undo it.
    const a = emptyEvidence();
    const b = emptyEvidence();
    a[2]!.hasToken = true;
    b[2]!.hasToken = false;
    expect(mergeEvidence(a, b)[2]!.hasToken).toBe(true);
    expect(mergeEvidence(b, a)[2]!.hasToken).toBe(true);
  });

  it('keeps "no token" when nothing has ever seen one', () => {
    const a = emptyEvidence();
    const b = emptyEvidence();
    a[2]!.hasToken = false;
    b[2]!.hasToken = false;
    expect(mergeEvidence(a, b)[2]!.hasToken).toBe(false);
  });

  it('accumulates across a sequence of partial captures', () => {
    // Three captures, each covering a different third of the board — together
    // they read the whole thing.
    let acc = emptyEvidence();
    for (const range of [[0, 6], [6, 13], [13, 19]]) {
      const capture = emptyEvidence();
      for (let i = range[0]!; i < range[1]!; i++) {
        capture[i]!.resourceCost = { ...decisive };
        capture[i]!.tokenCost = { 8: 2, 6: 25 };
        capture[i]!.hasToken = true;
      }
      acc = mergeEvidence(acc, capture);
    }
    expect(guidanceForEvidence(acc).isComplete).toBe(true);
  });
});

describe('guidanceForEvidence', () => {
  const strongEverywhere = (): HexEvidence[] =>
    emptyEvidence().map(e => ({
      ...e,
      resourceCost: { ...decisive },
      tokenCost: { 8: 2, 6: 25, 9: 30 },
      hasToken: true,
    }));

  it('asks for another look when nothing has been read', () => {
    const guidance = guidanceForEvidence(emptyEvidence());
    expect(guidance.isComplete).toBe(false);
    expect(guidance.weakHexes).toHaveLength(BOARD_HEX_COUNT);
    expect(guidance.overallConfidence).toBe(0);
  });

  it('stops asking once the whole board is clear', () => {
    const guidance = guidanceForEvidence(strongEverywhere());
    expect(guidance.isComplete).toBe(true);
    expect(guidance.weakHexes).toHaveLength(0);
    expect(guidance.suggestedRegion).toBeNull();
  });

  it('points at the region holding the most unclear tiles', () => {
    const evidence = strongEverywhere();
    // Knock out the top-left corner, as glare on one side would.
    for (const i of [0, 1, 3, 4]) evidence[i]!.resourceCost = { ...ambiguous };
    const guidance = guidanceForEvidence(evidence);
    expect(guidance.isComplete).toBe(false);
    expect(guidance.suggestedRegion).toBe('the top-left');
    expect(guidance.message).toMatch(/top-left/);
  });

  it('phrases a single remaining tile in the singular', () => {
    const evidence = strongEverywhere();
    evidence[9]!.resourceCost = { ...ambiguous };
    const guidance = guidanceForEvidence(evidence);
    expect(guidance.weakHexes).toEqual([9]);
    expect(guidance.message).toMatch(/1 tile is/);
  });

  it('reports rising confidence as captures accumulate', () => {
    const evidence = strongEverywhere();
    for (const i of [0, 1, 3, 4, 7, 8]) evidence[i]!.resourceCost = { ...ambiguous };
    const partial = guidanceForEvidence(evidence).overallConfidence;
    const full = guidanceForEvidence(strongEverywhere()).overallConfidence;
    expect(full).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(0);
  });

  it('covers every hex across its named regions', () => {
    // A hex in no region could never be pointed at.
    const covered = new Set(BOARD_REGIONS.flatMap(r => [...r.hexes]));
    for (let i = 0; i < BOARD_HEX_COUNT; i++) expect(covered.has(i)).toBe(true);
  });

  it('uses a threshold that accepts decisive readings and rejects coin tosses', () => {
    expect(hexConfidence(decisive)).toBeGreaterThan(CONFIDENCE_THRESHOLD);
    expect(hexConfidence(ambiguous)).toBeLessThan(CONFIDENCE_THRESHOLD);
  });
});

describe('accumulated evidence feeds the constraint solver', () => {
  it('produces a legal board from several partial captures', () => {
    let acc = emptyEvidence();
    for (const range of [[0, 10], [10, 19]]) {
      const capture = emptyEvidence();
      for (let i = range[0]!; i < range[1]!; i++) {
        capture[i]!.resourceCost = { grain: 5, wool: 25, lumber: 26, brick: 27, ore: 28, desert: 29 };
        capture[i]!.hasToken = i !== 0;
      }
      acc = mergeEvidence(acc, capture);
    }
    const { hexes } = reconcileBoardFromEvidence(acc);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });
});

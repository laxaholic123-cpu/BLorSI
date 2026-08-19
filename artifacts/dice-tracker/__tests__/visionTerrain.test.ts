/**
 * Terrain colour classification and evidence-based board reconciliation.
 *
 * The reference colours were measured from a twelve-photo set of a real board,
 * so these tests assert against numbers that came from the actual game, not from
 * an idealised palette.
 */

import {
  TERRAIN_CLASSES,
  TERRAIN_REFERENCES,
  labDistance,
  meanLab,
  medianLab,
  nearestTerrain,
  rgbToLab,
  sampleQuality,
  terrainCosts,
  terrainDistances,
  whiteBalance,
  type Lab,
} from '@/services/vision/terrainPalette';
import {
  BOARD_HEX_COUNT,
  reconcileBoardFromEvidence,
  validateBoardComposition,
  type HexEvidence,
} from '@/services/boardConstraints';
import type { ResourceType } from '@/types/models';

describe('rgbToLab', () => {
  it('maps white to L*100 with no chroma', () => {
    const lab = rgbToLab(255, 255, 255);
    expect(lab.L).toBeCloseTo(100, 1);
    expect(lab.a).toBeCloseTo(0, 1);
    expect(lab.b).toBeCloseTo(0, 1);
  });

  it('maps black to L*0', () => {
    expect(rgbToLab(0, 0, 0).L).toBeCloseTo(0, 1);
  });

  it('keeps mid grey neutral', () => {
    const lab = rgbToLab(128, 128, 128);
    expect(Math.abs(lab.a)).toBeLessThan(1);
    expect(Math.abs(lab.b)).toBeLessThan(1);
  });

  it('puts yellow far along +b and green along -a', () => {
    expect(rgbToLab(255, 255, 0).b).toBeGreaterThan(50);
    expect(rgbToLab(0, 255, 0).a).toBeLessThan(-50);
  });
});

describe('terrain references', () => {
  it('has a reference for every terrain the box contains', () => {
    expect(TERRAIN_CLASSES).toHaveLength(6);
    for (const t of TERRAIN_CLASSES) {
      expect(TERRAIN_REFERENCES[t]).toBeDefined();
    }
  });

  it('classifies each reference colour as itself', () => {
    for (const terrain of TERRAIN_CLASSES) {
      expect(nearestTerrain(TERRAIN_REFERENCES[terrain]!).terrain).toBe(terrain);
    }
  });

  it('separates the two greens that a naive classifier confuses', () => {
    // Pasture and forest are the classic confusion. They differ mainly in
    // chroma, which is why lightness is down-weighted rather than ignored.
    const d = labDistance(TERRAIN_REFERENCES['wool']!, TERRAIN_REFERENCES['lumber']!);
    expect(d).toBeGreaterThan(10);
  });

  it('recognises the desert as the pale one', () => {
    const desert = TERRAIN_REFERENCES['desert']!;
    for (const other of TERRAIN_CLASSES) {
      if (other === 'desert') continue;
      expect(desert.L).toBeGreaterThan(TERRAIN_REFERENCES[other]!.L - 15);
    }
  });
});

describe('labDistance', () => {
  it('is zero for identical colours', () => {
    const c: Lab = { L: 50, a: 10, b: 20 };
    expect(labDistance(c, c)).toBe(0);
  });

  it('down-weights lightness so glare does not reclassify a tile', () => {
    // Same hue, very different exposure — a sunlit pasture vs a shaded one.
    const lit: Lab = { L: 80, a: -25, b: 38 };
    const shade: Lab = { L: 35, a: -25, b: 38 };
    // Distance across 45 points of lightness stays smaller than the distance
    // between two genuinely different terrains.
    const glareGap = labDistance(lit, shade);
    const terrainGap = labDistance(
      TERRAIN_REFERENCES['wool']!,
      TERRAIN_REFERENCES['grain']!,
    );
    expect(glareGap).toBeLessThan(terrainGap);
  });

  it('still classifies a washed-out pasture as pasture', () => {
    const washedOut: Lab = { L: 78, a: -20, b: 34 };
    expect(nearestTerrain(washedOut).terrain).toBe('wool');
  });

  it('still classifies a shadowed field as a field', () => {
    const shadowed: Lab = { L: 40, a: 5, b: 44 };
    expect(nearestTerrain(shadowed).terrain).toBe('grain');
  });
});

describe('robust sampling', () => {
  it('takes a median rather than a mean, so glare pixels do not drag it', () => {
    const samples: Lab[] = [
      { L: 50, a: -25, b: 38 },
      { L: 52, a: -24, b: 39 },
      { L: 51, a: -26, b: 37 },
      { L: 99, a: 0, b: 0 }, // a blown-out highlight
    ];
    const median = medianLab(samples)!;
    expect(median.L).toBeLessThan(60);
    expect(median.a).toBeLessThan(-15);
    expect(nearestTerrain(median).terrain).toBe('wool');
  });

  it('returns null with nothing to sample', () => {
    expect(medianLab([])).toBeNull();
    expect(meanLab([])).toBeNull();
  });
});

describe('whiteBalance', () => {
  it('removes a shared warm cast without flattening the differences', () => {
    // Warm bulbs push every tile yellow, which drags pasture toward wheat.
    const cast = { L: 0, a: 6, b: 12 };
    const trueColours = [
      TERRAIN_REFERENCES['wool']!,
      TERRAIN_REFERENCES['lumber']!,
      TERRAIN_REFERENCES['grain']!,
    ];
    const shifted = trueColours.map(c => ({ L: c.L, a: c.a + cast.a, b: c.b + cast.b }));
    const boardMean = meanLab(shifted)!;
    const corrected = whiteBalance(shifted, boardMean);

    // Each tile lands nearer its own reference after correction than before.
    trueColours.forEach((truth, i) => {
      const before = labDistance(shifted[i]!, truth);
      const after = labDistance(corrected[i]!, truth);
      expect(after).toBeLessThanOrEqual(before);
    });
  });
});

describe('terrainDistances', () => {
  it('scores every terrain', () => {
    const scores = terrainDistances(TERRAIN_REFERENCES['ore']!);
    expect(Object.keys(scores).sort()).toEqual([...TERRAIN_CLASSES].sort());
    expect(scores['ore']).toBeCloseTo(0);
  });
});

// ─── Evidence-based reconciliation ────────────────────────────────────────────

/** Evidence with no opinion at all — the solver must still produce a legal board. */
function blankEvidence(): HexEvidence[] {
  return Array.from({ length: BOARD_HEX_COUNT }, (_, index) => ({
    index,
    resourceCost: {},
    tokenCost: {},
  }));
}

/** Evidence stating a confident reading for one terrain. */
function confident(terrain: ResourceType): Partial<Record<ResourceType, number>> {
  const costs: Partial<Record<ResourceType, number>> = {};
  for (const t of TERRAIN_CLASSES) costs[t] = t === terrain ? 0 : 20;
  return costs;
}

describe('reconcileBoardFromEvidence', () => {
  it('produces a legal board even from no evidence at all', () => {
    const { hexes } = reconcileBoardFromEvidence(blankEvidence());
    expect(hexes).toHaveLength(BOARD_HEX_COUNT);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('honours confident readings that fit the box', () => {
    const evidence = blankEvidence();
    evidence[0]!.resourceCost = confident('ore');
    evidence[1]!.resourceCost = confident('brick');
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes[0]!.resource).toBe('ore');
    expect(hexes[1]!.resource).toBe('brick');
  });

  it('overrules a confident reading that would break the component counts', () => {
    // Four ore tiles claimed; the box holds three.
    const evidence = blankEvidence();
    for (const i of [0, 1, 2, 3]) evidence[i]!.resourceCost = confident('ore');
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes.filter(h => h.resource === 'ore')).toHaveLength(3);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('uses a missing token as evidence of desert', () => {
    // The single most useful cross-signal: the desert is the only tile without
    // a token, and this arrives independently of colour.
    const evidence = blankEvidence();
    evidence.forEach(e => { e.hasToken = true; });
    evidence[7]!.hasToken = false;
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes[7]!.resource).toBe('desert');
  });

  it('keeps the desert off a hex that clearly has a token', () => {
    const evidence = blankEvidence();
    evidence.forEach(e => { e.hasToken = true; });
    evidence[3]!.hasToken = false;
    // Hex 5 looks like desert by colour, but carries a token.
    evidence[5]!.resourceCost = confident('desert');
    evidence[5]!.hasToken = true;
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes[5]!.resource).not.toBe('desert');
    expect(hexes[3]!.resource).toBe('desert');
  });

  it('rescues a glare-blanked tile from what the others leave over', () => {
    // Eighteen tiles read cleanly; the nineteenth is lost to glare and carries
    // no colour opinion whatsoever. The leftovers can only go one place.
    const layout: ResourceType[] = [
      'desert', 'grain', 'grain', 'grain', 'grain',
      'lumber', 'lumber', 'lumber', 'lumber',
      'wool', 'wool', 'wool', 'wool',
      'ore', 'ore', 'ore',
      'brick', 'brick', 'brick',
    ];
    const evidence = blankEvidence();
    layout.forEach((terrain, i) => {
      evidence[i]!.resourceCost = confident(terrain);
      evidence[i]!.hasToken = terrain !== 'desert';
    });
    // Blank out one tile completely.
    const lost = 14;
    evidence[lost]!.resourceCost = {};

    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes[lost]!.resource).toBe('ore');
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('gets stronger the more tiles read cleanly', () => {
    // With every other tile confident, two blanks still resolve uniquely.
    const layout: ResourceType[] = [
      'desert', 'grain', 'grain', 'grain', 'grain',
      'lumber', 'lumber', 'lumber', 'lumber',
      'wool', 'wool', 'wool', 'wool',
      'ore', 'ore', 'ore',
      'brick', 'brick', 'brick',
    ];
    const evidence = blankEvidence();
    layout.forEach((terrain, i) => {
      evidence[i]!.resourceCost = confident(terrain);
      evidence[i]!.hasToken = terrain !== 'desert';
    });
    evidence[2]!.resourceCost = {};
    evidence[17]!.resourceCost = {};

    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes[2]!.resource).toBe('grain');
    expect(hexes[17]!.resource).toBe('brick');
  });

  it('assigns tokens only to non-desert hexes', () => {
    const evidence = blankEvidence();
    evidence.forEach(e => { e.hasToken = true; });
    evidence[9]!.hasToken = false;
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes[9]!.number).toBeNull();
    expect(hexes.filter(h => h.number !== null)).toHaveLength(18);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('honours a confident token reading', () => {
    const evidence = blankEvidence();
    evidence.forEach(e => { e.hasToken = true; });
    evidence[0]!.hasToken = false; // desert
    evidence[5]!.tokenCost = { 8: 0, 6: 20, 9: 20 };
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes[5]!.number).toBe(8);
  });

  it('overrules a token reading that exceeds the supply', () => {
    // Three 6s claimed; the box holds two.
    const evidence = blankEvidence();
    evidence.forEach(e => { e.hasToken = true; });
    evidence[0]!.hasToken = false;
    for (const i of [1, 2, 3]) evidence[i]!.tokenCost = { 6: 0 };
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(hexes.filter(h => h.number === 6)).toHaveLength(2);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('marks overruled hexes low-confidence and reports the change', () => {
    const evidence = blankEvidence();
    for (const i of [0, 1, 2, 3]) evidence[i]!.resourceCost = confident('ore');
    const { hexes, changes } = reconcileBoardFromEvidence(evidence);
    const moved = changes.filter(c => c.field === 'resource');
    expect(moved.length).toBeGreaterThan(0);
    const movedHex = hexes[moved[0]!.hexIndex]!;
    expect(movedHex.confidence).toBe('low');
  });

  it('declines when the hex count is wrong rather than guessing', () => {
    const { hexes } = reconcileBoardFromEvidence(blankEvidence().slice(0, 18));
    expect(hexes).toEqual([]);
  });
});

describe('sampleQuality', () => {
  it('accepts an ordinary terrain colour', () => {
    for (const terrain of TERRAIN_CLASSES) {
      expect(sampleQuality(TERRAIN_REFERENCES[terrain]!)).toBe('good');
    }
  });

  it('rejects a blown-out highlight instead of calling it desert', () => {
    // Glare goes pale and neutral, which lands on the desert reference by
    // accident. Measured on the reference photos: this is the single biggest
    // source of false deserts.
    expect(sampleQuality({ L: 95, a: 1, b: 4 })).toBe('washed_out');
  });

  it('rejects deep shadow instead of calling it forest', () => {
    expect(sampleQuality({ L: 8, a: -2, b: 3 })).toBe('too_dark');
  });

  it('still accepts a bright but saturated tile', () => {
    // A sunlit field is bright AND colourful — that is not glare.
    expect(sampleQuality({ L: 85, a: 5, b: 45 })).toBe('good');
  });

  it('contributes no opinion when the sample is untrustworthy', () => {
    expect(terrainCosts({ L: 95, a: 1, b: 4 })).toEqual({});
    expect(Object.keys(terrainCosts(TERRAIN_REFERENCES['wool']!)).length).toBe(6);
  });

  it('lets the solver place a glare-blanked tile from the leftovers', () => {
    // An empty cost map is free, so the assignment is driven entirely by what
    // the box has left — which is the desired behaviour, not a fallback.
    const evidence = blankEvidence();
    evidence.forEach((e, i) => {
      e.hasToken = i !== 0;
      e.resourceCost = i === 5 ? terrainCosts({ L: 96, a: 0, b: 2 }) : {};
    });
    expect(evidence[5]!.resourceCost).toEqual({});
    const { hexes } = reconcileBoardFromEvidence(evidence);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });
});

/**
 * Tests for the Monte Carlo luck engine.
 *
 * Everything here is seeded, so the assertions are exact rather than
 * statistical. Where a test does assert a range, the range is wide enough to
 * survive a change of seed but narrow enough to catch a real regression.
 */

import {
  bandForPercentile,
  chiSquare,
  describePercentile,
  makeRng,
  percentileOf,
  rollTwoD6,
  simulateFitPercentile,
  simulateProductionPercentile,
} from '@/services/luckEngine';
import { TWO_D6_PROBS } from '@/services/stats';

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const drawsA = [a(), a(), a(), a()];
    const drawsB = [b(), b(), b(), b()];
    expect(drawsA).toEqual(drawsB);
  });

  it('produces different streams for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays within [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rollTwoD6', () => {
  it('only ever produces 2 through 12', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 5000; i++) {
      const v = rollTwoD6(rng);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(12);
    }
  });

  it('reproduces the 2D6 shape — 7 is the most common outcome', () => {
    const rng = makeRng(3);
    const counts = new Array(13).fill(0);
    for (let i = 0; i < 50_000; i++) counts[rollTwoD6(rng)]++;
    const mostCommon = counts.indexOf(Math.max(...counts));
    expect(mostCommon).toBe(7);
    // 7 should land near 1/6 of all rolls.
    expect(counts[7] / 50_000).toBeGreaterThan(0.15);
    expect(counts[7] / 50_000).toBeLessThan(0.18);
  });
});

describe('percentileOf', () => {
  it('splits ties at the midpoint', () => {
    expect(percentileOf(5, [5, 5, 5, 5])).toBe(50);
  });

  it('reports 0 for a value below everything', () => {
    expect(percentileOf(0, [1, 2, 3, 4])).toBe(0);
  });

  it('reports 100 for a value above everything', () => {
    expect(percentileOf(9, [1, 2, 3, 4])).toBe(100);
  });

  it('places a middling value in the middle', () => {
    expect(percentileOf(3, [1, 2, 4, 5])).toBe(50);
  });

  it('defaults to 50 with no samples', () => {
    expect(percentileOf(1, [])).toBe(50);
  });
});

describe('simulateProductionPercentile', () => {
  /** A player producing 1 on an 8 and 1 on a 6, every turn. */
  const steadyWeights = (rolls: number) => {
    const table: number[][] = [];
    for (let i = 0; i < rolls; i++) {
      const row = new Array(13).fill(0);
      row[8] = 1;
      row[6] = 1;
      table.push(row);
    }
    return table;
  };

  it('puts an exactly-average result near the 50th percentile', () => {
    const rolls = 100;
    const table = steadyWeights(rolls);
    // Expected production = 100 × (5/36 + 5/36) ≈ 27.8
    const expected = rolls * (5 / 36 + 5 / 36);
    const result = simulateProductionPercentile(table, expected, { iterations: 4000, seed: 11 });
    expect(result.percentile).toBeGreaterThan(35);
    expect(result.percentile).toBeLessThan(65);
  });

  it('puts a starved result in the bottom tail', () => {
    const table = steadyWeights(100);
    const result = simulateProductionPercentile(table, 10, { iterations: 4000, seed: 11 });
    expect(result.percentile).toBeLessThan(2);
  });

  it('puts a flooded result in the top tail', () => {
    const table = steadyWeights(100);
    const result = simulateProductionPercentile(table, 45, { iterations: 4000, seed: 11 });
    expect(result.percentile).toBeGreaterThan(98);
  });

  it('recovers the theoretical mean of the distribution', () => {
    const rolls = 200;
    const table = steadyWeights(rolls);
    const expected = rolls * (5 / 36 + 5 / 36);
    const result = simulateProductionPercentile(table, expected, { iterations: 4000, seed: 5 });
    expect(result.simMean).toBeGreaterThan(expected - 1.5);
    expect(result.simMean).toBeLessThan(expected + 1.5);
  });

  it('is reproducible for a given seed', () => {
    const table = steadyWeights(50);
    const a = simulateProductionPercentile(table, 15, { iterations: 1000, seed: 123 });
    const b = simulateProductionPercentile(table, 15, { iterations: 1000, seed: 123 });
    expect(a).toEqual(b);
  });

  it('widens the distribution as the game gets longer', () => {
    const short = simulateProductionPercentile(steadyWeights(30), 8, { iterations: 3000, seed: 8 });
    const long = simulateProductionPercentile(steadyWeights(200), 55, { iterations: 3000, seed: 8 });
    // Absolute spread grows with sample size...
    expect(long.simStdDev).toBeGreaterThan(short.simStdDev);
    // ...but RELATIVE spread shrinks, which is the whole reason a fixed
    // percentage threshold was the wrong test.
    expect(long.simStdDev / long.simMean).toBeLessThan(short.simStdDev / short.simMean);
  });
});

describe('chiSquare', () => {
  it('is zero for a perfect fit', () => {
    const probs = [0.5, 0.5];
    expect(chiSquare([50, 50], probs, 100)).toBeCloseTo(0);
  });

  it('grows as observations diverge from expectation', () => {
    const probs = [0.5, 0.5];
    const mild = chiSquare([55, 45], probs, 100);
    const severe = chiSquare([80, 20], probs, 100);
    expect(severe).toBeGreaterThan(mild);
  });

  it('skips impossible categories rather than dividing by zero', () => {
    const probs = [0.5, 0.5, 0];
    expect(Number.isFinite(chiSquare([50, 50, 0], probs, 100))).toBe(true);
  });
});

describe('simulateFitPercentile', () => {
  const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const PROBS = VALUES.map(v => TWO_D6_PROBS[v]!);

  /** Counts drawn exactly in proportion to the true 2D6 distribution. */
  const idealCounts = (total: number) => PROBS.map(p => p * total);

  it('places a textbook-perfect distribution low', () => {
    const result = simulateFitPercentile(idealCounts(180), PROBS, 180, {
      iterations: 2000,
      seed: 17,
    });
    expect(result.percentile).toBeLessThan(20);
  });

  it('flags a distribution that is the wrong shape', () => {
    // 180 rolls, every one of them a 7. Mean is exactly 7 — perfectly on target.
    const counts = VALUES.map(v => (v === 7 ? 180 : 0));
    const result = simulateFitPercentile(counts, PROBS, 180, { iterations: 2000, seed: 17 });
    expect(result.percentile).toBeGreaterThan(99);
  });

  it('flags a barbell distribution whose mean is exactly correct', () => {
    // This is the case the mean z-score is structurally blind to: half 2s and
    // half 12s averages exactly 7, the same as fair dice.
    const counts = VALUES.map(v => (v === 2 || v === 12 ? 90 : 0));
    const result = simulateFitPercentile(counts, PROBS, 180, { iterations: 2000, seed: 17 });
    expect(result.percentile).toBeGreaterThan(99);
  });

  it('is reproducible for a given seed', () => {
    const counts = idealCounts(60);
    const a = simulateFitPercentile(counts, PROBS, 60, { iterations: 500, seed: 4 });
    const b = simulateFitPercentile(counts, PROBS, 60, { iterations: 500, seed: 4 });
    expect(a).toEqual(b);
  });
});

describe('bandForPercentile', () => {
  it('maps percentiles to bands', () => {
    expect(bandForPercentile(0.5)).toBe('very_unlucky');
    expect(bandForPercentile(5)).toBe('unlucky');
    expect(bandForPercentile(50)).toBe('normal');
    expect(bandForPercentile(95)).toBe('lucky');
    expect(bandForPercentile(99.5)).toBe('very_lucky');
  });

  it('keeps the bulk of fair results in the normal band', () => {
    // Bands should leave ~80% of outcomes unremarkable.
    expect(bandForPercentile(11)).toBe('normal');
    expect(bandForPercentile(89)).toBe('normal');
  });
});

describe('describePercentile', () => {
  it('phrases the tails the way a player would say them', () => {
    expect(describePercentile(3)).toBe('unluckier than 97% of simulated games');
    expect(describePercentile(97)).toBe('luckier than 97% of simulated games');
    expect(describePercentile(50)).toBe('dead average');
  });
});

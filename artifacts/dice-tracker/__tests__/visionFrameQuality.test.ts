/**
 * The gate that protects live accumulation.
 *
 * Continuous capture merges every accepted frame, and merging sums costs — so a
 * misaligned frame does not waste a moment, it accumulates confident nonsense,
 * many times a second. These tests are deliberately biased toward rejection:
 * losing a good frame costs a thirtieth of a second, accepting a bad one
 * corrupts the board.
 */

import {
  MIN_COVERAGE,
  assessFrame,
  looksLikeABoard,
  shouldMergeFrame,
} from '@/services/vision/frameQuality';
import { TERRAIN_REFERENCES, type Lab } from '@/services/vision/terrainPalette';

const T = TERRAIN_REFERENCES;

/** A plausible board: a mixture of terrains at all 19 positions. */
function realisticBoard(): Lab[] {
  const layout = [
    'desert', 'grain', 'grain', 'grain', 'grain',
    'lumber', 'lumber', 'lumber', 'lumber',
    'wool', 'wool', 'wool', 'wool',
    'ore', 'ore', 'ore',
    'brick', 'brick', 'brick',
  ];
  return layout.map(t => ({ ...T[t]! }));
}

const GLARE: Lab = { L: 96, a: 1, b: 3 };
const SHADOW: Lab = { L: 6, a: 0, b: 1 };

describe('assessFrame', () => {
  it('accepts a well-aligned, well-lit board', () => {
    const result = assessFrame(realisticBoard());
    expect(result.usable).toBe(true);
    expect(result.coverage).toBe(1);
  });

  it('rejects a frame with no board in view', () => {
    const result = assessFrame(new Array(19).fill(null));
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/not in view/i);
  });

  it('rejects a frame where the board has drifted out of the guide', () => {
    // Alignment slipping is systematic: most samples go wrong at once. Below
    // 30% coverage the diagnosis is misalignment rather than camera shake.
    const frame = realisticBoard();
    for (let i = 0; i < 15; i++) frame[i] = GLARE;
    const result = assessFrame(frame);
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/line the board up/i);
  });

  it('tells the user to hold steady on a marginal frame', () => {
    // Between 30% and 70% coverage reads as movement rather than as total
    // misalignment — the board is there, the shot is just unsteady.
    const frame = realisticBoard();
    for (let i = 0; i < 9; i++) frame[i] = GLARE;
    const result = assessFrame(frame);
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/steady/i);
  });

  it('rejects a frame that is simply too dark', () => {
    const result = assessFrame(new Array(19).fill(SHADOW));
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/dark|light/i);
  });

  it('tolerates a few bad tiles without discarding the frame', () => {
    // Glare on two tiles is normal and should not cost the other seventeen.
    const frame = realisticBoard();
    frame[0] = GLARE;
    frame[1] = GLARE;
    expect(assessFrame(frame).usable).toBe(true);
  });

  it('uses a coverage bar strict enough to catch systematic failure', () => {
    // The guarded failure mode takes out most hexes at once, so the threshold
    // has to sit well above half.
    expect(MIN_COVERAGE).toBeGreaterThan(0.6);
  });
});

describe('looksLikeABoard', () => {
  it('accepts a real mixture of terrains', () => {
    expect(looksLikeABoard(realisticBoard())).toBe(true);
  });

  it('rejects a uniform surface that fills the guide', () => {
    // A table, a rug, a closed box — anything that would otherwise produce
    // confident and entirely wrong readings.
    expect(looksLikeABoard(new Array(19).fill({ ...T['wool']! }))).toBe(false);
  });

  it('rejects a surface showing too little variety', () => {
    const twoTone = new Array(19)
      .fill(null)
      .map((_, i) => ({ ...(i % 2 ? T['grain']! : T['wool']!) }));
    expect(looksLikeABoard(twoTone)).toBe(false);
  });

  it('rejects a frame with too little to go on', () => {
    const sparse: (Lab | null)[] = new Array(19).fill(null);
    sparse[0] = { ...T['wool']! };
    sparse[1] = { ...T['grain']! };
    expect(looksLikeABoard(sparse)).toBe(false);
  });

  it('still accepts a board read imperfectly', () => {
    // Several misreads is normal; the mixture is what matters.
    const frame = realisticBoard();
    frame[3] = { ...T['ore']! };
    frame[7] = { ...T['ore']! };
    frame[11] = { ...T['brick']! };
    expect(looksLikeABoard(frame)).toBe(true);
  });
});

describe('shouldMergeFrame', () => {
  it('lets a genuine board through', () => {
    expect(shouldMergeFrame(realisticBoard()).usable).toBe(true);
  });

  it('blocks a uniform surface even when it is well lit and fully covered', () => {
    // This is the dangerous case: every quality signal is fine, and the frame
    // is still not a board.
    const uniform = new Array(19).fill({ ...T['lumber']! });
    const assessed = assessFrame(uniform);
    expect(assessed.usable).toBe(true); // quality alone says yes
    expect(shouldMergeFrame(uniform).usable).toBe(false); // the gate says no
    expect(shouldMergeFrame(uniform).reason).toMatch(/point the camera/i);
  });

  it('blocks a misaligned frame before it can be merged', () => {
    const frame = realisticBoard();
    for (let i = 0; i < 15; i++) frame[i] = GLARE;
    expect(shouldMergeFrame(frame).usable).toBe(false);
  });

  it('always explains itself', () => {
    // The reason is shown live under the viewfinder, so it must never be blank.
    for (const frame of [
      realisticBoard(),
      new Array(19).fill(null),
      new Array(19).fill(SHADOW),
      new Array(19).fill({ ...T['wool']! }),
    ]) {
      expect(shouldMergeFrame(frame).reason.length).toBeGreaterThan(0);
    }
  });
});

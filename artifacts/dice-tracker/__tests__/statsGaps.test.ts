/**
 * Regression tests for getLongestGap.
 *
 * The drought a player actually complains about is almost always the one still
 * open when the game ends ("I haven't rolled an 8 since turn six"). The original
 * implementation only committed a gap when the value reappeared, so that exact
 * case reported nothing.
 *
 * NOTE ON FIXTURES: every value in a fixture competes for "worst offender", so
 * filler rolls are always repeats of one number — a value that appears on
 * consecutive rolls has a gap of 0 and cannot beat the value under test.
 */

import { getLongestGap } from '@/services/stats';

describe('getLongestGap', () => {
  it('counts a drought that never ends before the session does', () => {
    // 8 appears once, then five consecutive 3s. 3's own gaps are all 0.
    const values = [8, 3, 3, 3, 3, 3];
    expect(getLongestGap(values, 2, 12)).toEqual({ value: 8, longestGap: 5 });
  });

  it('still counts a drought that closes mid-session', () => {
    // 8 at index 0 and index 4 → three rolls in between, then it reappears.
    const values = [8, 3, 3, 3, 8, 3];
    expect(getLongestGap(values, 2, 12)).toEqual({ value: 8, longestGap: 3 });
  });

  it('reports the longer of a closed gap and a trailing gap', () => {
    // 8: a closed gap of 2, then a trailing gap of 4 → the trailing one wins.
    const values = [8, 3, 3, 8, 3, 3, 3, 3];
    expect(getLongestGap(values, 2, 12)).toEqual({ value: 8, longestGap: 4 });
  });

  it('ignores values that have never been rolled', () => {
    // 12 never appears, so it is not reported despite being "absent" throughout.
    const values = [5, 3, 3, 3];
    expect(getLongestGap(values, 2, 12)).toEqual({ value: 5, longestGap: 3 });
  });

  it('returns null when there is nothing to measure', () => {
    expect(getLongestGap([], 2, 12)).toBeNull();
    expect(getLongestGap([7], 2, 12)).toBeNull();
  });

  it('returns the worst offender across all values', () => {
    // 2 sits idle for 6 rolls, 3 for 5, 4 never (consecutive).
    const values = [2, 3, 4, 4, 4, 4, 4];
    expect(getLongestGap(values, 2, 12)).toEqual({ value: 2, longestGap: 6 });
  });
});

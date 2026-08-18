/**
 * Shared chart palette tests.
 *
 * Backlog #55 asked for regression cover on heat-map colouring and #65 for the
 * two charts to stop contradicting each other. Both reduce to one property: a
 * given (count, expected, totalRolls) must produce one temperature, and that
 * temperature must produce one colour — no matter which chart is asking.
 */

import {
  COLD_COLOR,
  HEAT_MIN_SAMPLE,
  HOT_COLOR,
  SEVEN_COLOR,
  classifyRollTemperature,
  sevenChipColors,
  temperatureAccent,
  temperatureChipColors,
} from '@/constants/chartPalette';

/** Minimal stand-in for the colour tokens the hook provides. */
const colors = {
  muted: '#1F1F1F',
  mutedForeground: '#9A9A9A',
} as unknown as Parameters<typeof temperatureChipColors>[1];

describe('classifyRollTemperature', () => {
  it('stays silent below the minimum sample', () => {
    expect(classifyRollTemperature(3, 1.39, 10)).toBe('unknown');
  });

  it('calls a number on target neutral', () => {
    expect(classifyRollTemperature(25, 25, 180)).toBe('neutral');
  });

  it('returns unknown when nothing was expected', () => {
    expect(classifyRollTemperature(0, 0, 180)).toBe('unknown');
  });

  it('scales with sample size — the same ratio means different things', () => {
    // 40% above expectation. In a short game that is ordinary variance; over a
    // long one it is a real signal. A fixed percentage band cannot tell those
    // apart, which is exactly the bug this replaced.
    const short = classifyRollTemperature(8, 5.7, 41); // z ~ 1.04
    const long = classifyRollTemperature(39, 27.8, 200); // z ~ 2.26
    expect(short).toBe('neutral');
    expect(long).toBe('hot');
  });

  it('keeps a real 41-roll game mostly neutral', () => {
    // Counts from an actual game on device. Before standardising, nine of these
    // eleven numbers were coloured, which tells a player nothing.
    const total = 41;
    const p: Record<number, number> = {
      2: 1 / 36, 3: 2 / 36, 4: 3 / 36, 5: 4 / 36, 6: 5 / 36, 7: 6 / 36,
      8: 5 / 36, 9: 4 / 36, 10: 3 / 36, 11: 2 / 36, 12: 1 / 36,
    };
    const counts: Record<number, number> = {
      2: 3, 3: 5, 4: 3, 5: 5, 6: 3, 7: 4, 8: 3, 9: 3, 10: 1, 11: 8, 12: 3,
    };

    const temps = Object.keys(counts).map(k => {
      const n = Number(k);
      return classifyRollTemperature(counts[n]!, p[n]! * total, total);
    });
    const coloured = temps.filter(t => t !== 'neutral' && t !== 'unknown');

    // Fewer than half lit up, and the 11 (eight rolls against 2.3 expected)
    // is the one that stands out strongly.
    expect(coloured.length).toBeLessThanOrEqual(5);
    expect(classifyRollTemperature(8, p[11]! * total, total)).toBe('hot');
    // The 6, 7, 8 cluster is well within normal variance at this sample size.
    expect(classifyRollTemperature(3, p[6]! * total, total)).toBe('neutral');
    expect(classifyRollTemperature(4, p[7]! * total, total)).toBe('neutral');
    expect(classifyRollTemperature(3, p[8]! * total, total)).toBe('neutral');
  });

  it('grades both directions once the deviation is real', () => {
    // expected 25 of 180, sd = sqrt(25 * (1 - 25/180)) ~ 4.64
    expect(classifyRollTemperature(35, 25, 180)).toBe('hot');   // z ~ 2.2
    expect(classifyRollTemperature(31, 25, 180)).toBe('warm');  // z ~ 1.3
    expect(classifyRollTemperature(19, 25, 180)).toBe('cool');  // z ~ -1.3
    expect(classifyRollTemperature(15, 25, 180)).toBe('cold');  // z ~ -2.2
  });

  it('treats a long drought as cold', () => {
    expect(classifyRollTemperature(0, 25, 180)).toBe('cold');
  });

  it('does not colour anything under the sample floor', () => {
    expect(classifyRollTemperature(50, 5, HEAT_MIN_SAMPLE - 1)).toBe('unknown');
  });
});

describe('palette agreement', () => {
  it('paints hot teal and cold slate — never green and red', () => {
    // The heat map used to paint hot green (#22C55E) and cold red (#EF4444)
    // while the frequency chart used teal and slate, so the same number could
    // be green on one screen and slate on another.
    expect(temperatureAccent('hot', colors)).toBe(HOT_COLOR);
    expect(temperatureAccent('cold', colors)).toBe(COLD_COLOR);
    expect(temperatureChipColors('hot', colors).text).toBe(HOT_COLOR);
    expect(temperatureChipColors('cold', colors).text).toBe(COLD_COLOR);
  });

  it('never uses the seven colour for a hot or cold number', () => {
    for (const t of ['hot', 'warm', 'neutral', 'cool', 'cold', 'unknown'] as const) {
      expect(temperatureAccent(t, colors)).not.toBe(SEVEN_COLOR);
      expect(temperatureChipColors(t, colors).text).not.toBe(SEVEN_COLOR);
    }
  });

  it('keeps the seven off the hot/cold scale entirely', () => {
    expect(sevenChipColors(4, colors).text).toBe(SEVEN_COLOR);
    expect(sevenChipColors(0, colors).bg).toBe(colors.muted);
  });

  it('falls back to muted tokens when there is nothing to say', () => {
    expect(temperatureChipColors('unknown', colors).bg).toBe(colors.muted);
    expect(temperatureChipColors('neutral', colors).text).toBe(colors.mutedForeground);
    expect(temperatureAccent('neutral', colors)).toBe(colors.mutedForeground);
  });

  it('gives warm and cool softer variants than their extremes', () => {
    expect(temperatureAccent('warm', colors)).not.toBe(temperatureAccent('hot', colors));
    expect(temperatureAccent('cool', colors)).not.toBe(temperatureAccent('cold', colors));
  });
});

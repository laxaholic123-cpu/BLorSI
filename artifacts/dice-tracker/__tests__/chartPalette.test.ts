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
    // Three 8s in ten rolls is a ratio of ~2.2 and means nothing.
    expect(classifyRollTemperature(3, 1.39, 10)).toBe('unknown');
  });

  it('calls a number on target neutral', () => {
    expect(classifyRollTemperature(25, 25, 180)).toBe('neutral');
  });

  it('grades the hot side', () => {
    expect(classifyRollTemperature(30, 25, 180)).toBe('warm'); // ratio 1.2
    expect(classifyRollTemperature(40, 25, 180)).toBe('hot');  // ratio 1.6
  });

  it('grades the cold side', () => {
    expect(classifyRollTemperature(20, 25, 180)).toBe('cool'); // ratio 0.8
    expect(classifyRollTemperature(10, 25, 180)).toBe('cold'); // ratio 0.4
  });

  it('treats a number that never came up as cold, not unknown', () => {
    expect(classifyRollTemperature(0, 25, 180)).toBe('cold');
  });

  it('returns unknown when nothing was expected', () => {
    expect(classifyRollTemperature(0, 0, 180)).toBe('unknown');
  });

  it('leaves an ordinary game mostly neutral', () => {
    // Counts within ±15% of expectation should not light up. If the thresholds
    // are ever loosened, this is what should fail — a chart where everything is
    // coloured tells the player nothing.
    const expected = 25;
    for (const count of [22, 23, 24, 25, 26, 27, 28]) {
      expect(classifyRollTemperature(count, expected, 180)).toBe('neutral');
    }
  });

  it('does not colour anything at exactly one under the sample floor', () => {
    expect(classifyRollTemperature(50, 5, HEAT_MIN_SAMPLE - 1)).toBe('unknown');
    expect(classifyRollTemperature(50, 5, HEAT_MIN_SAMPLE)).toBe('hot');
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

/**
 * Live callouts, and the two things that would make them dishonest.
 *
 * The interesting tests are not "does it detect a streak" — that is arithmetic.
 * They are (1) does it ever use the language of luck, which it must not,
 * because the sequential-testing problem makes any live probability claim
 * wrong; and (2) how OFTEN does it fire on fair dice, which is a rate that has
 * to be measured rather than assumed.
 */

import {
  CALLOUT_CATALOGUE,
  COOLDOWN_ROLLS,
  calloutForLatestRoll,
  calloutsForSession,
  rememberCallout,
  type Callout,
  type CalloutKind,
} from '@/services/liveCallouts';
import { boardStateAtTurn } from '@/services/catanBoardState';
import { getAllIntersections } from '@/services/catanBoard';
import type { CatanPlayerExposureEvent, RollEvent } from '@/types/models';

function rolls(values: number[]): RollEvent[] {
  return values.map((value, i) => ({
    id: `r${i}`,
    sessionId: 's1',
    playerId: `p${i % 3}`,
    value,
    turnNumber: i + 1,
    sequenceNumber: i + 1,
    timestamp: new Date(1700000000000 + i * 1000).toISOString(),
    source: 'touchscreen' as const,
  }));
}

/** A seeded fair 2d6, so the rate measurement is reproducible. */
function fairRolls(n: number, seed = 12345): RollEvent[] {
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    values.push(1 + Math.floor(next() * 6) + 1 + Math.floor(next() * 6));
  }
  return rolls(values);
}

describe('the candidate set is fixed', () => {
  it('declares every kind it can emit', () => {
    const declared = new Set(CALLOUT_CATALOGUE.map(c => c.kind));
    const emitted = new Set<CalloutKind>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const c of calloutsForSession({ rolls: fairRolls(200, seed) })) {
        emitted.add(c.kind);
      }
    }
    for (const kind of emitted) expect(declared.has(kind)).toBe(true);
  });

  it('has no duplicate kinds', () => {
    const kinds = CALLOUT_CATALOGUE.map(c => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('callouts never make a claim about luck', () => {
  /**
   * The words that would turn a description into a verdict. A live screen
   * cannot say any of these honestly — the simulation that would justify them
   * runs once, at the end, in luckEngine.
   */
  const FORBIDDEN = [
    'luck', 'lucky', 'unlucky', 'unfair', 'fair', 'rigged', 'cursed', 'blessed',
    'odds', 'probability', 'probable', 'likely', 'unlikely', 'rare', 'improbable',
    'expected', 'deserve', 'should have', 'skill', 'better than', 'worse than',
  ];

  it('emits no forbidden word across many simulated sessions', () => {
    const seen: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      for (const c of calloutsForSession({ rolls: fairRolls(150, seed) })) {
        seen.push(c.text);
      }
    }
    expect(seen.length).toBeGreaterThan(20); // otherwise this proves nothing
    for (const text of seen) {
      const lower = text.toLowerCase();
      for (const word of FORBIDDEN) {
        expect(lower).not.toContain(word);
      }
    }
  });

  it('says the same about the catalogue descriptions', () => {
    for (const entry of CALLOUT_CATALOGUE) {
      const lower = entry.describes.toLowerCase();
      for (const word of FORBIDDEN) expect(lower).not.toContain(word);
    }
  });
});

describe('how often it fires on FAIR dice', () => {
  /**
   * The rate is the safety property. Every callout is true, so a high rate is
   * not "wrong" — but a screen that says something every other roll trains
   * people to ignore it, and it would make an ordinary game feel eventful.
   * Measured rather than assumed.
   */
  it('stays sparse over a long fair session', () => {
    const rates: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const r = fairRolls(120, seed);
      rates.push(calloutsForSession({ rolls: r }).length / r.length);
    }
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const worst = Math.max(...rates);
    /**
     * MEASURED: 9.4% over 3600 fair rolls — about one callout every 11 rolls,
     * so roughly nine in a 100-roll game. The bound is set just above that so
     * a change which makes the screen chatty fails here loudly.
     *
     * It was 14.3% before `number_drought` was made relative to each number's
     * own expected gap, and that one kind was over half the total. See the
     * note on DROUGHT_MULTIPLE — a flat gap threshold across eleven outcomes
     * with different frequencies is the ±15%-band mistake wearing a new hat.
     */
    expect(mean).toBeLessThan(0.11);
    expect(worst).toBeLessThan(0.17);
  });

  it('spreads across kinds instead of one kind dominating', () => {
    // The tell for a mis-scaled threshold: a single kind carrying the rate.
    const counts = new Map<string, number>();
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const c of calloutsForSession({ rolls: fairRolls(120, seed) })) {
        counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
        total += 1;
      }
    }
    const biggest = Math.max(...counts.values());
    expect(biggest / total).toBeLessThan(0.4);
  });

  it('emits nothing at all early on, when there is nothing to say', () => {
    expect(calloutsForSession({ rolls: fairRolls(6, 99) })).toEqual([]);
  });
});

describe('one callout per roll, with a cooldown', () => {
  it('returns at most one for a roll that triggers several', () => {
    // 3+ sevens in a window AND a run of sevens: both fire on the same roll.
    const c = calloutForLatestRoll({ rolls: rolls([7, 7, 7]) });
    expect(c).not.toBeNull();
    expect(Array.isArray(c)).toBe(false);
  });

  it('prefers the more specific observation', () => {
    const c = calloutForLatestRoll({ rolls: rolls([7, 7, 7]) });
    expect(c?.kind).toBe('streak');
  });

  it('suppresses a repeat of the same kind inside the cooldown', () => {
    const first = calloutForLatestRoll({ rolls: rolls([5, 5, 5]) })!;
    expect(first.kind).toBe('streak');
    const recent = rememberCallout(new Map(), first);
    const again = calloutForLatestRoll({ rolls: rolls([5, 5, 5, 5]), recent });
    expect(again).toBeNull();
  });

  it('allows the kind back after the cooldown passes', () => {
    const early: Callout = { kind: 'streak', text: 'x', sequenceNumber: 1 };
    const recent = rememberCallout(new Map(), early);
    const values = [...Array(COOLDOWN_ROLLS + 2).fill(4), 9, 9, 9];
    const c = calloutForLatestRoll({ rolls: rolls(values), recent });
    expect(c?.kind).toBe('streak');
  });
});

describe('individual observations are true', () => {
  it('counts a run correctly', () => {
    expect(calloutForLatestRoll({ rolls: rolls([2, 8, 8, 8]) })?.text).toBe('3 8s in a row.');
  });

  it('does not call two in a row a run', () => {
    expect(calloutForLatestRoll({ rolls: rolls([2, 8, 8]) })).toBeNull();
  });

  it('reports a first sighting only once the game is under way', () => {
    const late = [...Array(22).fill(5), 12];
    expect(calloutForLatestRoll({ rolls: rolls(late) })?.kind).toBe('first_sighting');
    const early = [5, 5, 12];
    expect(calloutForLatestRoll({ rolls: rolls(early) })).toBeNull();
  });

  it('ignores deleted rolls, because undo must undo', () => {
    const r = rolls([6, 6, 6]);
    r[1]!.deletedAt = new Date().toISOString();
    expect(calloutForLatestRoll({ rolls: r })).toBeNull();
  });

  it('notices every number having appeared, and says so once', () => {
    const all = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const found = calloutsForSession({ rolls: rolls(all) }).filter(
      c => c.kind === 'full_house',
    );
    expect(found).toHaveLength(1);
  });
});

describe('board-aware callouts', () => {
  const corners = getAllIntersections();
  const withNumbers = (cornerId: string, numbers: number[]): CatanPlayerExposureEvent =>
    ({
      id: 'e1', sessionId: 's1', playerId: 'p0', turnNumber: 1,
      timestamp: new Date().toISOString(), eventType: 'initialSettlement',
      affectedNumbers: numbers, hexIdentifiers: [cornerId],
      productionWeight: 1, robberBlocked: false,
    }) as CatanPlayerExposureEvent;

  it('says when a number nobody owns comes up', () => {
    const snapshot = boardStateAtTurn([withNumbers(corners[0]!.id, [6, 9])], ['p0']);
    const c = calloutForLatestRoll({ rolls: rolls([4]), snapshot });
    expect(c?.kind).toBe('unowned_number');
    expect(c?.text).toContain('4');
  });

  it('stays quiet when somebody does own it', () => {
    const snapshot = boardStateAtTurn([withNumbers(corners[0]!.id, [6, 9])], ['p0']);
    expect(calloutForLatestRoll({ rolls: rolls([6]), snapshot })).toBeNull();
  });

  it('names the player blocked on the number that just came up', () => {
    const c = calloutForLatestRoll({
      rolls: rolls([8]),
      blockedByPlayer: new Map([['p0', [8]]]),
      nameOf: () => 'Ada',
    });
    expect(c?.kind).toBe('blocked_hit');
    expect(c?.text).toContain('Ada');
    expect(c?.playerId).toBe('p0');
  });
});

describe('determinism', () => {
  it('gives the same callouts for the same log every time', () => {
    const r = fairRolls(150, 7);
    const a = calloutsForSession({ rolls: r });
    const b = calloutsForSession({ rolls: r });
    expect(a).toEqual(b);
  });
});

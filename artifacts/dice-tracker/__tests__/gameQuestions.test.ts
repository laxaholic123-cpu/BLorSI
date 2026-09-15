/**
 * The end-of-game questions, answered from a small hand-built game whose right
 * answers are known by construction.
 */

import { getAllIntersections } from '@/services/catanBoard';
import {
  QUESTION_FOR_ACCOLADE,
  answerGameQuestions,
  orderForAccolade,
} from '@/services/gameQuestions';
import type { CatanPlayerProductionStats } from '@/types/catanStats';
import type { CatanHexDef, CatanPlayerExposureEvent, RollEvent } from '@/types/models';

const players = [
  { id: 'a', displayName: 'Alex' },
  { id: 'b', displayName: 'Bo' },
];

let seq = 0;
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString();

const roll = (playerId: string, value: number, minute: number, turnNumber = 1): RollEvent => ({
  id: `r${++seq}`,
  sessionId: 's',
  playerId,
  value,
  turnNumber,
  sequenceNumber: seq,
  timestamp: at(minute),
  source: 'touchscreen',
});

const settlement = (playerId: string, corner: string, numbers: number[], minute: number): CatanPlayerExposureEvent => ({
  id: `e${++seq}`,
  sessionId: 's',
  playerId,
  eventType: 'initialSettlement',
  turnNumber: 0,
  timestamp: at(minute),
  affectedNumbers: numbers,
  hexIdentifiers: [corner],
  productionWeight: 1,
  robberBlocked: false,
});

const robberOn = (victim: string, minute: number, extra: Record<string, unknown> = {}): CatanPlayerExposureEvent => ({
  id: `e${++seq}`,
  sessionId: 's',
  playerId: victim,
  eventType: 'robberBlockStarted',
  turnNumber: 1,
  timestamp: at(minute),
  affectedNumbers: [4],
  hexIdentifiers: [`rblock_${seq}`],
  productionWeight: 0,
  robberBlocked: true,
  ...extra,
});

const stats = (id: string, over: Partial<CatanPlayerProductionStats>): CatanPlayerProductionStats => ({
  playerId: id,
  displayName: players.find(p => p.id === id)!.displayName,
  totalActualProduction: 10,
  totalExpectedProduction: 10,
  productionLuck: 0,
  productionLuckPct: 0,
  placementStrength: 0,
  numberDiversity: 0,
  portAccess: [],
  robberLostProduction: 0,
  initialBuildingCount: 1,
  finalCityCount: 0,
  ...over,
} as CatanPlayerProductionStats);

/** Every tile a 2 of grain, except the ones a test sets. One pip each. */
function board(over: Record<number, Partial<CatanHexDef>> = {}): CatanHexDef[] {
  return Array.from({ length: 19 }, (_, index) => ({
    index,
    resource: 'grain',
    number: 2,
    confidence: 'high',
    ...over[index],
  })) as CatanHexDef[];
}

const answer = (map: ReturnType<typeof answerGameQuestions>, id: string, key: string) =>
  map.get(id)!.find(q => q.key === key)?.answer;

describe('who kept putting the robber on me', () => {
  it('names the player whose 7 came just before the move', () => {
    const got = answerGameQuestions({
      players,
      stats: [stats('a', { robberLostProduction: 5 }), stats('b', {})],
      rollEvents: [roll('b', 7, 1), roll('a', 6, 3), roll('b', 7, 5)],
      exposureEvents: [robberOn('a', 2), robberOn('a', 6)],
    });
    const text = answer(got, 'a', 'robbed_by')!;
    expect(text).toMatch(/Bo twice/);
    expect(text).toMatch(/cost you 5 production/);
  });

  it('prefers a recorded mover to any inference', () => {
    const got = answerGameQuestions({
      players,
      stats: [stats('a', {}), stats('b', {})],
      rollEvents: [roll('b', 7, 1)],
      exposureEvents: [robberOn('a', 2, { movedByPlayerId: 'a' })],
    });
    expect(answer(got, 'a', 'robbed_by')).toMatch(/yourself once/);
  });

  it('does not pin a knight on whoever happened to roll last', () => {
    // The roll before this move was a 6, so it was not a 7 being resolved.
    // A knight played before its owner rolled would otherwise be blamed on
    // the previous player, who did nothing.
    const got = answerGameQuestions({
      players,
      stats: [stats('a', {}), stats('b', {})],
      rollEvents: [roll('b', 6, 1)],
      exposureEvents: [robberOn('a', 2)],
    });
    const text = answer(got, 'a', 'robbed_by')!;
    expect(text).not.toMatch(/Bo/);
    expect(text).toMatch(/did not record who moved it/);
  });

  it('says so plainly when the robber never touched them', () => {
    const got = answerGameQuestions({
      players, stats: [stats('a', {}), stats('b', {})], rollEvents: [], exposureEvents: [],
    });
    expect(answer(got, 'b', 'robbed_by')).toMatch(/^Nobody/);
  });
});

describe('did I pick well in the opening', () => {
  // An interior corner touching three tiles; make it by far the best on the board.
  const interior = getAllIntersections().find(i => i.hexIndices.length === 3)!;
  const hexes = board(Object.fromEntries(interior.hexIndices.map((h, k) => [h, { number: [6, 8, 5][k] }])));
  const coastal = getAllIntersections().find(i =>
    i.hexIndices.length === 1 && !i.hexIndices.some(h => interior.hexIndices.includes(h)))!;

  it('ranks each pick against the corners still legal at that moment', () => {
    const got = answerGameQuestions({
      players,
      stats: [stats('a', {}), stats('b', {})],
      rollEvents: [],
      exposureEvents: [
        settlement('a', interior.id, [6, 8, 5], 1),
        settlement('b', coastal.id, [2], 2),
      ],
      hexes,
    });
    expect(answer(got, 'a', 'draft_picks')).toMatch(/First pick: 14 pips, the best spot left/);
    // Bo took a one-tile shore corner while three-tile corners were still free.
    const bo = answer(got, 'b', 'draft_picks')!;
    expect(bo).toMatch(/First pick: 1 pip\b/);
    expect(bo).not.toMatch(/1 pips/);
    // Many three-tile corners were still open, so this is past the ordinals.
    expect(bo).toMatch(/The best spot left had \d+, and \d+ open spots beat it/);
  });

  it('stays silent without a board rather than guessing', () => {
    const got = answerGameQuestions({
      players, stats: [stats('a', {}), stats('b', {})], rollEvents: [],
      exposureEvents: [settlement('a', interior.id, [6, 8, 5], 1)],
    });
    expect(answer(got, 'a', 'draft_picks')).toBeUndefined();
  });
});

describe('did the dice change where I finished', () => {
  it('reports a player the dice dropped', () => {
    const got = answerGameQuestions({
      players,
      stats: [
        stats('a', { totalExpectedProduction: 30, totalActualProduction: 20 }),
        stats('b', { totalExpectedProduction: 20, totalActualProduction: 25 }),
      ],
      rollEvents: [], exposureEvents: [],
    });
    expect(answer(got, 'a', 'average_dice')).toMatch(/against you.*1st of 2.*left you 2nd/);
    expect(answer(got, 'b', 'average_dice')).toMatch(/in your favour.*2nd of 2.*carried you to 1st/);
  });

  it('never claims a win, because it only knows production', () => {
    const got = answerGameQuestions({
      players, stats: [stats('a', {}), stats('b', {})], rollEvents: [], exposureEvents: [],
    });
    expect(answer(got, 'a', 'average_dice')).toMatch(/Production, not points/);
  });
});

describe('buildings and whose dice', () => {
  const corner = getAllIntersections().find(i => i.hexIndices.length === 3)!;
  const input = () => ({
    players,
    stats: [stats('a', {}), stats('b', {})],
    rollEvents: [roll('b', 6, 1), roll('a', 8, 2), roll('b', 6, 3), roll('b', 7, 4)],
    exposureEvents: [settlement('a', corner.id, [6, 8], 0)],
  });

  it('credits the thrower whose rolls actually paid out', () => {
    const got = answerGameQuestions(input());
    expect(answer(got, 'a', 'fed_by')).toMatch(/^Bo's rolls paid you the most: 2 of your 3/);
  });

  it('names the building that did the work', () => {
    const got = answerGameQuestions(input());
    expect(answer(got, 'a', 'best_building')).toMatch(/settlement on the (6-8|8-6) corner brought in 3 — 100%/);
  });

  it('does not count 7s as production', () => {
    const got = answerGameQuestions({ ...input(), rollEvents: [roll('b', 7, 1)] });
    expect(answer(got, 'a', 'fed_by')).toMatch(/^Nobody/);
  });
});

describe('ordering on an accolade card', () => {
  it('puts the question the accolade raises first', () => {
    const got = answerGameQuestions({
      players, stats: [stats('a', {}), stats('b', {})], rollEvents: [], exposureEvents: [],
    });
    const ordered = orderForAccolade('robber_losses', got.get('a')!);
    expect(ordered[0]!.key).toBe('robbed_by');
    expect(orderForAccolade('harbours', got.get('a')!)[0]!.key).toBe('harbour_fit');
  });

  it('maps only to questions that exist', () => {
    const keys = new Set(['robbed_by', 'draft_picks', 'average_dice', 'best_building', 'fed_by', 'harbour_fit']);
    for (const q of Object.values(QUESTION_FOR_ACCOLADE)) expect(keys.has(q)).toBe(true);
  });
});

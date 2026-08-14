/**
 * Development card deck tests.
 *
 * The subtlety worth guarding is that the deck is SHARED and drawn WITHOUT
 * replacement: one player's victory point cards are cards nobody else can have.
 * A per-player simulation that ignored that would overstate everyone's luck.
 */

import {
  DEV_CARD_TYPES,
  DEV_DECK_COMPOSITION,
  DEV_DECK_SIZE,
  activeDraws,
  buildDeck,
  computeDevCardStats,
  countsForPlayer,
  validateDraws,
} from '@/services/devCards';
import type { CatanDevCardEvent, CatanDevCardType, Player } from '@/types/models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const player = (id: string): Player => ({
  id,
  displayName: id,
  color: '#F5A623',
  seatNumber: 1,
  createdAt: '2026-01-01T00:00:00Z',
});

let seq = 0;
const draw = (
  playerId: string,
  cardType: CatanDevCardType,
  overrides: Partial<CatanDevCardEvent> = {},
): CatanDevCardEvent => ({
  id: `d${++seq}`,
  sessionId: 's1',
  playerId,
  cardType,
  turnNumber: seq,
  sequenceNumber: seq,
  timestamp: '2026-01-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  seq = 0;
});

describe('deck composition', () => {
  it('holds 25 cards', () => {
    const total = Object.values(DEV_DECK_COMPOSITION).reduce((s, n) => s + n, 0);
    expect(total).toBe(DEV_DECK_SIZE);
    expect(buildDeck()).toHaveLength(DEV_DECK_SIZE);
  });

  it('is mostly knights', () => {
    expect(DEV_DECK_COMPOSITION.knight).toBe(14);
    expect(DEV_DECK_COMPOSITION.victoryPoint).toBe(5);
    expect(DEV_DECK_COMPOSITION.roadBuilding).toBe(2);
    expect(DEV_DECK_COMPOSITION.yearOfPlenty).toBe(2);
    expect(DEV_DECK_COMPOSITION.monopoly).toBe(2);
  });

  it('builds a deck matching the composition exactly', () => {
    const deck = buildDeck();
    for (const type of DEV_CARD_TYPES) {
      expect(deck.filter(c => c === type)).toHaveLength(DEV_DECK_COMPOSITION[type]);
    }
  });
});

describe('activeDraws', () => {
  it('excludes soft-deleted draws', () => {
    const events = [
      draw('alice', 'knight'),
      draw('alice', 'victoryPoint', { deletedAt: '2026-01-01T01:00:00Z' }),
    ];
    expect(activeDraws(events)).toHaveLength(1);
  });

  it('sorts by draw order regardless of array order', () => {
    const a = draw('alice', 'knight');
    const b = draw('bob', 'monopoly');
    const ordered = activeDraws([b, a]);
    expect(ordered.map(e => e.sequenceNumber)).toEqual([a.sequenceNumber, b.sequenceNumber]);
  });
});

describe('countsForPlayer', () => {
  it('tallies each card type', () => {
    const events = [
      draw('alice', 'knight'),
      draw('alice', 'knight'),
      draw('alice', 'victoryPoint'),
      draw('bob', 'monopoly'),
    ];
    const counts = countsForPlayer('alice', events);
    expect(counts.knight).toBe(2);
    expect(counts.victoryPoint).toBe(1);
    expect(counts.monopoly).toBe(0);
    expect(counts.total).toBe(3);
  });

  it('ignores undone draws', () => {
    const events = [
      draw('alice', 'knight'),
      draw('alice', 'knight', { deletedAt: '2026-01-01T01:00:00Z' }),
    ];
    expect(countsForPlayer('alice', events).knight).toBe(1);
  });
});

describe('validateDraws', () => {
  it('accepts a plausible set of draws', () => {
    const events = [draw('alice', 'knight'), draw('bob', 'victoryPoint')];
    expect(validateDraws(events)).toEqual([]);
  });

  it('flags more knights than the deck contains', () => {
    const events = Array.from({ length: 15 }, () => draw('alice', 'knight'));
    const problems = validateDraws(events);
    expect(problems.some(p => p.kind === 'overdrawn_type')).toBe(true);
  });

  it('flags a sixth victory point card', () => {
    const events = Array.from({ length: 6 }, () => draw('alice', 'victoryPoint'));
    expect(validateDraws(events).some(p => p.kind === 'overdrawn_type')).toBe(true);
  });

  it('flags drawing more cards than exist', () => {
    const events = [
      ...Array.from({ length: 14 }, () => draw('alice', 'knight')),
      ...Array.from({ length: 5 }, () => draw('alice', 'victoryPoint')),
      ...Array.from({ length: 2 }, () => draw('alice', 'roadBuilding')),
      ...Array.from({ length: 2 }, () => draw('alice', 'yearOfPlenty')),
      ...Array.from({ length: 2 }, () => draw('alice', 'monopoly')),
      draw('alice', 'knight'),
    ];
    expect(validateDraws(events).some(p => p.kind === 'overdrawn_deck')).toBe(true);
  });
});

describe('computeDevCardStats', () => {
  const players = [player('alice'), player('bob')];

  it('reports an empty deck state with no draws', () => {
    const stats = computeDevCardStats(players, []);
    expect(stats.totalDraws).toBe(0);
    expect(stats.remainingInDeck).toBe(DEV_DECK_SIZE);
    expect(stats.playerStats).toHaveLength(2);
  });

  it('tracks how much of the deck is gone', () => {
    const events = [draw('alice', 'knight'), draw('bob', 'knight'), draw('alice', 'monopoly')];
    const stats = computeDevCardStats(players, events);
    expect(stats.totalDraws).toBe(3);
    expect(stats.remainingInDeck).toBe(DEV_DECK_SIZE - 3);
  });

  it('omits percentiles unless simulation is requested', () => {
    const events = [draw('alice', 'victoryPoint'), draw('bob', 'knight')];
    const stats = computeDevCardStats(players, events);
    expect(stats.playerStats[0]!.victoryPointPercentile).toBeUndefined();
  });

  it('rates a player who drew every victory point card as extremely lucky', () => {
    // Alice takes all 5 VP cards in 6 draws; Bob takes 6 cards and gets none.
    const events = [
      ...Array.from({ length: 5 }, () => draw('alice', 'victoryPoint')),
      draw('alice', 'knight'),
      ...Array.from({ length: 6 }, () => draw('bob', 'knight')),
    ];
    const stats = computeDevCardStats(players, events, {
      simulate: true,
      iterations: 2000,
      seed: 3,
    });
    const alice = stats.playerStats.find(p => p.playerId === 'alice')!;
    const bob = stats.playerStats.find(p => p.playerId === 'bob')!;
    expect(alice.victoryPointPercentile!).toBeGreaterThan(99);
    expect(bob.victoryPointPercentile!).toBeLessThan(50);
  });

  it('rates an all-knight haul as unlucky on victory points', () => {
    const events = [
      ...Array.from({ length: 8 }, () => draw('alice', 'knight')),
      ...Array.from({ length: 8 }, () => draw('bob', 'knight')),
    ];
    const stats = computeDevCardStats(players, events, {
      simulate: true,
      iterations: 2000,
      seed: 3,
    });
    // Eight draws with no VP card is a genuinely poor run.
    expect(stats.playerStats[0]!.victoryPointPercentile!).toBeLessThan(20);
  });

  it('scores knights separately from victory points', () => {
    const events = [
      ...Array.from({ length: 10 }, () => draw('alice', 'knight')),
      ...Array.from({ length: 2 }, () => draw('bob', 'victoryPoint')),
    ];
    const stats = computeDevCardStats(players, events, {
      simulate: true,
      iterations: 2000,
      seed: 3,
    });
    const alice = stats.playerStats.find(p => p.playerId === 'alice')!;
    expect(alice.knightPercentile!).toBeGreaterThan(alice.victoryPointPercentile!);
  });

  it('is reproducible for a given seed', () => {
    const events = [draw('alice', 'victoryPoint'), draw('bob', 'knight')];
    const opts = { simulate: true, iterations: 500, seed: 9 } as const;
    const a = computeDevCardStats(players, events, opts);
    const b = computeDevCardStats(players, events, opts);
    expect(a.playerStats[0]!.victoryPointPercentile).toBe(
      b.playerStats[0]!.victoryPointPercentile,
    );
  });

  it('gives the same answer regardless of the order cards were drawn in', () => {
    // This is why entry can wait until the game is over. Dealing without
    // replacement is exchangeable: given how many cards each player drew, the
    // joint distribution of their hands does not depend on who drew when. If
    // this ever stopped holding, end-of-game entry would be losing information.
    const interleaved = [
      draw('alice', 'knight'),
      draw('bob', 'victoryPoint'),
      draw('alice', 'victoryPoint'),
      draw('bob', 'knight'),
      draw('alice', 'knight'),
      draw('bob', 'monopoly'),
    ];
    // Same per-player counts, but grouped by player the way end-of-game entry
    // rebuilds them.
    seq = 0;
    const grouped = [
      draw('alice', 'knight'),
      draw('alice', 'knight'),
      draw('alice', 'victoryPoint'),
      draw('bob', 'knight'),
      draw('bob', 'victoryPoint'),
      draw('bob', 'monopoly'),
    ];

    const opts = { simulate: true, iterations: 3000, seed: 42 } as const;
    const a = computeDevCardStats(players, interleaved, opts);
    const b = computeDevCardStats(players, grouped, opts);

    for (const playerId of ['alice', 'bob']) {
      const fromA = a.playerStats.find(p => p.playerId === playerId)!;
      const fromB = b.playerStats.find(p => p.playerId === playerId)!;
      expect(fromA.counts).toEqual(fromB.counts);
      expect(fromA.victoryPointPercentile).toBe(fromB.victoryPointPercentile);
      expect(fromA.knightPercentile).toBe(fromB.knightPercentile);
    }
  });

  it('surfaces deck problems alongside the stats', () => {
    const events = Array.from({ length: 6 }, () => draw('alice', 'victoryPoint'));
    const stats = computeDevCardStats(players, events);
    expect(stats.problems.length).toBeGreaterThan(0);
  });

  it('does not simulate an impossible over-drawn deck', () => {
    const events = Array.from({ length: DEV_DECK_SIZE + 1 }, () => draw('alice', 'knight'));
    const stats = computeDevCardStats(players, events, { simulate: true, iterations: 100 });
    expect(stats.playerStats[0]!.victoryPointPercentile).toBeUndefined();
  });

  it('ignores draws from players not in the session', () => {
    const events = [draw('alice', 'knight'), draw('ghost', 'victoryPoint')];
    const stats = computeDevCardStats(players, events, {
      simulate: true,
      iterations: 200,
      seed: 1,
    });
    expect(stats.playerStats).toHaveLength(2);
    expect(stats.playerStats.every(p => typeof p.victoryPointPercentile === 'number')).toBe(true);
  });
});

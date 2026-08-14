/**
 * Development card deck statistics.
 *
 * All functions are pure — no side effects, no storage calls, no UI imports.
 *
 * Dev card draws are the second genuine luck surface in the game, after the
 * dice. The deck's composition is fixed and public, the order is random, and
 * what you pull is not a decision you made — which is exactly the shape the
 * app's thesis cares about.
 *
 * The important subtlety is that the deck is SHARED and drawn WITHOUT
 * replacement. If one player takes three victory point cards, nobody else can.
 * So a player's luck cannot be simulated in isolation: the whole deck is
 * shuffled and dealt out in the order the draws actually happened, and every
 * player's haul falls out of that one deal.
 */

import type { CatanDevCardEvent, CatanDevCardType, Player } from '@/types/models';
import { makeRng, percentileOf, type SimOptions } from '@/services/luckEngine';

// ─── Deck composition ─────────────────────────────────────────────────────────

/** The base game deck: 25 cards. */
export const DEV_DECK_COMPOSITION: Readonly<Record<CatanDevCardType, number>> = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
};

export const DEV_DECK_SIZE = 25;

export const DEV_CARD_LABELS: Readonly<Record<CatanDevCardType, string>> = {
  knight: 'Knight',
  victoryPoint: 'Victory Point',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
};

export const DEV_CARD_TYPES = Object.keys(DEV_DECK_COMPOSITION) as CatanDevCardType[];

/** The deck as a flat array, one entry per physical card. */
export function buildDeck(): CatanDevCardType[] {
  const deck: CatanDevCardType[] = [];
  for (const type of DEV_CARD_TYPES) {
    for (let i = 0; i < DEV_DECK_COMPOSITION[type]; i++) deck.push(type);
  }
  return deck;
}

// ─── Per-player tallies ───────────────────────────────────────────────────────

export interface DevCardCounts {
  knight: number;
  victoryPoint: number;
  roadBuilding: number;
  yearOfPlenty: number;
  monopoly: number;
  total: number;
}

const emptyCounts = (): DevCardCounts => ({
  knight: 0,
  victoryPoint: 0,
  roadBuilding: 0,
  yearOfPlenty: 0,
  monopoly: 0,
  total: 0,
});

/** Active (non-deleted) draws, in the order they were taken. */
export function activeDraws(events: ReadonlyArray<CatanDevCardEvent>): CatanDevCardEvent[] {
  return events
    .filter(e => !e.deletedAt)
    .slice()
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

export function countsForPlayer(
  playerId: string,
  events: ReadonlyArray<CatanDevCardEvent>,
): DevCardCounts {
  const counts = emptyCounts();
  for (const event of activeDraws(events)) {
    if (event.playerId !== playerId) continue;
    counts[event.cardType] += 1;
    counts.total += 1;
  }
  return counts;
}

export interface DeckProblem {
  kind: 'overdrawn_deck' | 'overdrawn_type';
  message: string;
}

/**
 * Check recorded draws against what the box contains. Catches mis-taps — you
 * cannot draw a fifteenth knight or a twenty-sixth card.
 */
export function validateDraws(events: ReadonlyArray<CatanDevCardEvent>): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const draws = activeDraws(events);

  if (draws.length > DEV_DECK_SIZE) {
    problems.push({
      kind: 'overdrawn_deck',
      message: `${draws.length} cards recorded, but the deck holds ${DEV_DECK_SIZE}.`,
    });
  }

  const byType = new Map<CatanDevCardType, number>();
  for (const draw of draws) byType.set(draw.cardType, (byType.get(draw.cardType) ?? 0) + 1);
  for (const type of DEV_CARD_TYPES) {
    const actual = byType.get(type) ?? 0;
    const expected = DEV_DECK_COMPOSITION[type];
    if (actual > expected) {
      problems.push({
        kind: 'overdrawn_type',
        message: `${actual} ${DEV_CARD_LABELS[type]} cards recorded; the deck holds ${expected}.`,
      });
    }
  }

  return problems;
}

// ─── Deck luck ────────────────────────────────────────────────────────────────

export interface DevCardPlayerStats {
  playerId: string;
  displayName: string;
  counts: DevCardCounts;
  /**
   * Percentile of this player's victory point haul among simulated shuffles,
   * 0–100. Undefined when simulation was not requested or nobody drew.
   *
   * Victory points are the purest luck signal in the deck: they are worth a
   * point the moment you draw one, with no decision attached. Knights are
   * valuable too, but how much they are worth depends on how you play them, so
   * folding them into one "deck luck" number would mean inventing an exchange
   * rate — the same trap as ports.
   */
  victoryPointPercentile?: number;
  /** Percentile of this player's knight haul, reported separately. */
  knightPercentile?: number;
}

export interface DevCardStats {
  totalDraws: number;
  remainingInDeck: number;
  playerStats: DevCardPlayerStats[];
  problems: DeckProblem[];
}

/**
 * Deal a shuffled deck out in the recorded draw pattern.
 *
 * `drawOrder` is the sequence of player indices, one entry per recorded draw.
 * Returns per-player counts of the chosen card type.
 */
function simulateDeal(
  drawOrder: ReadonlyArray<number>,
  playerCount: number,
  target: CatanDevCardType,
  rng: () => number,
  deck: CatanDevCardType[],
): number[] {
  // Fisher-Yates over a reused buffer — this runs thousands of times.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }

  const tally = new Array<number>(playerCount).fill(0);
  for (let i = 0; i < drawOrder.length; i++) {
    if (deck[i] === target) tally[drawOrder[i]!] += 1;
  }
  return tally;
}

function percentileForType(
  drawOrder: ReadonlyArray<number>,
  playerCount: number,
  target: CatanDevCardType,
  actualPerPlayer: ReadonlyArray<number>,
  opts: SimOptions,
): number[] {
  const iterations = opts.iterations ?? 5_000;
  const rng = makeRng(opts.seed ?? 0x0dec);
  const deck = buildDeck();
  const samples: number[][] = Array.from({ length: playerCount }, () => []);

  for (let i = 0; i < iterations; i++) {
    const tally = simulateDeal(drawOrder, playerCount, target, rng, deck);
    for (let p = 0; p < playerCount; p++) samples[p]!.push(tally[p]!);
  }

  return actualPerPlayer.map((actual, p) => percentileOf(actual, samples[p]!));
}

export interface DevCardOptions extends SimOptions {
  /** Run the shuffle simulation and populate percentiles. Off by default. */
  simulate?: boolean;
}

export function computeDevCardStats(
  players: ReadonlyArray<Player>,
  events: ReadonlyArray<CatanDevCardEvent>,
  options: DevCardOptions = {},
): DevCardStats {
  const draws = activeDraws(events);
  const playerIndex = new Map(players.map((p, i) => [p.id, i]));

  const counts = players.map(p => countsForPlayer(p.id, events));

  // Draws by players not in this session cannot be simulated, so they are left
  // out of the deal pattern rather than silently shifting everyone else's odds.
  const drawOrder: number[] = [];
  for (const draw of draws) {
    const idx = playerIndex.get(draw.playerId);
    if (idx !== undefined) drawOrder.push(idx);
  }

  let vpPercentiles: number[] | undefined;
  let knightPercentiles: number[] | undefined;
  if (options.simulate && drawOrder.length > 0 && drawOrder.length <= DEV_DECK_SIZE) {
    vpPercentiles = percentileForType(
      drawOrder,
      players.length,
      'victoryPoint',
      counts.map(c => c.victoryPoint),
      options,
    );
    knightPercentiles = percentileForType(
      drawOrder,
      players.length,
      'knight',
      counts.map(c => c.knight),
      options,
    );
  }

  return {
    totalDraws: draws.length,
    remainingInDeck: Math.max(0, DEV_DECK_SIZE - draws.length),
    playerStats: players.map((player, i) => ({
      playerId: player.id,
      displayName: player.displayName,
      counts: counts[i]!,
      ...(vpPercentiles ? { victoryPointPercentile: vpPercentiles[i] } : {}),
      ...(knightPercentiles ? { knightPercentile: knightPercentiles[i] } : {}),
    })),
    problems: validateDraws(events),
  };
}

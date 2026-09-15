/**
 * The questions a table actually argues about when a Catan game ends, answered
 * from the log.
 *
 * The accolades rank everybody on an axis — "Robber Magnet, 1st of 4" — which
 * is a fact, but it is not the ARGUMENT. The argument is "who kept doing that
 * to me", "did I blow the opening", "would it have gone differently with fair
 * dice". Every one of those can be answered from what the app already records,
 * and none of them was.
 *
 * Each answer belongs to a player, and `orderForAccolade` puts the question
 * their own accolade raises first, so tapping a badge answers the question the
 * badge provokes and then everything else about that player's game.
 *
 * RULES THE WORDING FOLLOWS, same as the rest of the results screen:
 *   - Every answer is a count or a comparison of counts. Whether a gap is
 *     remarkable stays with the percentile, which has a simulation behind it.
 *   - When the log cannot say, the answer says so rather than guessing. A knight
 *     moved before this recorded who moved it names nobody.
 *
 * Pure: no React Native, fully testable.
 */

import { getAllIntersections } from '@/services/catanBoard';
import { legalSettlements, slotsFromOpeningEvents } from '@/services/catanPlacement';
import {
  CATAN_PIPS,
  getActiveRobberBlockedNumbers,
  getBuildingStatesAtTurn,
  netWeightForNumber,
} from '@/services/catanStats';
import { resourceExposure } from '@/services/exposureReport';
import type { CatanPlayerProductionStats } from '@/types/catanStats';
import type {
  CatanHexDef,
  CatanPlayerExposureEvent,
  Player,
  RollEvent,
} from '@/types/models';

export type QuestionKey =
  | 'robbed_by'
  | 'draft_picks'
  | 'average_dice'
  | 'best_building'
  | 'fed_by'
  | 'harbour_fit';

export interface AnsweredQuestion {
  key: QuestionKey;
  question: string;
  answer: string;
}

export interface GameQuestionInput {
  players: readonly Pick<Player, 'id' | 'displayName'>[];
  stats: readonly CatanPlayerProductionStats[];
  rollEvents: readonly RollEvent[];
  exposureEvents: readonly CatanPlayerExposureEvent[];
  /** The board, when there is one. Some answers need terrain and say so without. */
  hexes?: readonly CatanHexDef[] | null;
}

export const QUESTIONS: Record<QuestionKey, string> = {
  robbed_by: 'Who kept putting the robber on me?',
  draft_picks: 'Did I pick well in the opening?',
  average_dice: 'Did the dice change where I finished?',
  best_building: 'Which of my buildings did the most work?',
  fed_by: 'Whose dice fed me?',
  harbour_fit: 'Did my harbour match what I produced?',
};

/** The question each accolade raises, so its card answers it first. */
export const QUESTION_FOR_ACCOLADE: Record<string, QuestionKey> = {
  robber_losses: 'robbed_by',
  placement_strength: 'draft_picks',
  number_diversity: 'draft_picks',
  expected_engine: 'draft_picks',
  luck_percentile: 'average_dice',
  production_delta: 'average_dice',
  actual_output: 'average_dice',
  cities: 'best_building',
  buildings: 'best_building',
  expansions: 'best_building',
  first_city: 'best_building',
  gave_to_others: 'fed_by',
  kept_for_self: 'fed_by',
  harbours: 'harbour_fit',
};

/** A player's answers with the one their accolade raises first. */
export function orderForAccolade(
  kind: string,
  answers: readonly AnsweredQuestion[],
): AnsweredQuestion[] {
  const lead = QUESTION_FOR_ACCOLADE[kind];
  return [...answers].sort((a, b) => (a.key === lead ? -1 : b.key === lead ? 1 : 0));
}

const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? 'th';
  return `${n}${s}`;
};
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const round = (n: number) => Math.round(n);

/** Dice odds of a corner: pips of every numbered tile it touches. */
function cornerPips(cornerId: string, hexes: readonly CatanHexDef[]): number {
  const corner = getAllIntersections().find(i => i.id === cornerId);
  if (!corner) return 0;
  return corner.hexIndices.reduce((sum, h) => {
    const n = hexes[h]?.number;
    return sum + (typeof n === 'number' ? CATAN_PIPS[n] ?? 0 : 0);
  }, 0);
}

/** "the 6 grain / 8 ore corner", strongest tile first, or numbers only without a board. */
function describeCorner(
  cornerId: string,
  numbers: readonly number[],
  hexes: readonly CatanHexDef[] | null | undefined,
): string {
  const corner = getAllIntersections().find(i => i.id === cornerId);
  if (hexes && corner) {
    const parts = corner.hexIndices
      .map(h => hexes[h])
      .filter((h): h is CatanHexDef => !!h && typeof h.number === 'number' && !!h.resource)
      .sort((a, b) => (CATAN_PIPS[b.number!] ?? 0) - (CATAN_PIPS[a.number!] ?? 0))
      .map(h => `${h.number} ${h.resource}`);
    if (parts.length > 0) return `the ${parts.join(' / ')} corner`;
  }
  const nums = [...numbers].sort((a, b) => (CATAN_PIPS[b] ?? 0) - (CATAN_PIPS[a] ?? 0));
  return nums.length > 0 ? `the ${nums.join('-')} corner` : 'a corner';
}

// ─── Who kept putting the robber on me? ──────────────────────────────────────

/**
 * Who moved the robber for a given block.
 *
 * Recorded directly on moves made since `movedByPlayerId` existed. For older
 * moves it is inferred ONLY when the roll just before the move was a 7, because
 * a 7 is thrown and resolved by the same player. A knight can be played before
 * its owner rolls, so the previous roll says nothing about who played it, and
 * those moves are counted as unattributed rather than pinned on a bystander.
 */
function moverOf(
  block: CatanPlayerExposureEvent,
  rollsByTime: readonly RollEvent[],
): string | null {
  const recorded = (block as { movedByPlayerId?: string }).movedByPlayerId;
  if (recorded) return recorded;
  const at = Date.parse(block.timestamp);
  if (!Number.isFinite(at)) return null;
  let previous: RollEvent | null = null;
  for (const r of rollsByTime) {
    if (Date.parse(r.timestamp) > at) break;
    previous = r;
  }
  return previous && previous.value === 7 ? previous.playerId : null;
}

function robbedBy(input: GameQuestionInput, playerId: string): string {
  const name = (id: string) =>
    id === playerId ? 'you' : input.players.find(p => p.id === id)?.displayName ?? 'someone';
  const rolls = input.rollEvents
    .filter(r => !r.deletedAt)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const blocks = input.exposureEvents.filter(
    e => e.playerId === playerId && e.eventType === 'robberBlockStarted',
  );
  if (blocks.length === 0) return 'Nobody. The robber never landed on your buildings.';

  const counts = new Map<string, number>();
  let unattributed = 0;
  for (const b of blocks) {
    const mover = moverOf(b, rolls);
    if (mover) counts.set(mover, (counts.get(mover) ?? 0) + 1);
    else unattributed++;
  }

  const lost = input.stats.find(s => s.playerId === playerId)?.robberLostProduction ?? 0;
  const cost = lost > 0 ? ` It cost you ${round(lost)} production in all.` : '';
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return `It landed on you ${times(blocks.length)}, but the game did not record who moved it.${cost}`;
  }
  const list = ranked.map(([id, n]) => {
    const who = name(id);
    return who === 'you' ? `you did it to yourself ${times(n)}` : `${who} ${times(n)}`;
  });
  const head = list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const tail = unattributed > 0
    ? ` ${unattributed === 1 ? 'One more move' : `${unattributed} more moves`} came from a knight or was not recorded with a mover.`
    : '';
  return `${head.charAt(0).toUpperCase()}${head.slice(1)}.${cost}${tail}`;
}

// ─── Did I pick well in the opening? ─────────────────────────────────────────

function draftPicks(input: GameQuestionInput, playerId: string): string | null {
  const hexes = input.hexes;
  if (!hexes || hexes.length === 0) return null;
  const slots = slotsFromOpeningEvents(input.players.map(p => p.id), input.exposureEvents);
  const mine = slots.filter(s => s.playerId === playerId && s.settlement);
  if (mine.length === 0) return null;

  const picks = mine.map(slot => {
    // Legal AT THE TIME: hide every pick made after this one. The legality
    // check counts all other slots, so without this a later neighbour would
    // wrongly rule out a corner that was free when this player chose.
    const then = slots.map(s => (s.index < slot.index ? s : { ...s, settlement: null, road: null }));
    const values = legalSettlements(then, slot.index).map(id => cornerPips(id, hexes));
    const chosen = cornerPips(slot.settlement!, hexes);
    const best = values.length > 0 ? Math.max(...values) : chosen;
    const rank = 1 + values.filter(v => v > chosen).length;
    return { round: slot.round, chosen, best, rank };
  });

  const pips = (n: number) => `${n} ${n === 1 ? 'pip' : 'pips'}`;
  /*
    A deep rank is noise, not information. Read from a simulated game, "the
    27th best spot left" was both harsher and less useful than it looked: many
    corners tie on pips, and what a player wants to know is whether a clearly
    better spot was open. So ordinals stop at fifth, and past that the answer
    says how many open spots beat theirs.
  */
  const phrase = (p: (typeof picks)[number], label: string) => {
    if (p.rank === 1) return `${label} ${pips(p.chosen)}, the best spot left.`;
    if (p.rank <= 5) {
      return `${label} ${pips(p.chosen)}, the ${ord(p.rank)} best spot left (the best had ${p.best}).`;
    }
    const beat = p.rank - 1;
    return `${label} ${pips(p.chosen)}. The best spot left had ${p.best}, and ${beat} open ${beat === 1 ? 'spot' : 'spots'} beat it.`;
  };
  const labels = ['First pick:', 'Second pick:'];
  const body = picks.map((p, i) => phrase(p, labels[i] ?? `Pick ${i + 1}:`)).join(' ');
  return `${body} By dice odds only — resources and harbours are your call.`;
}

// ─── Did the dice change where I finished? ───────────────────────────────────

function rankOf(values: readonly { id: string; v: number }[], id: string): number {
  const mine = values.find(x => x.id === id)?.v ?? 0;
  return 1 + values.filter(x => x.v > mine).length;
}

function averageDice(input: GameQuestionInput, playerId: string): string | null {
  const s = input.stats;
  if (s.length < 2) return null;
  const n = s.length;
  const onPaper = rankOf(s.map(p => ({ id: p.playerId, v: p.totalExpectedProduction })), playerId);
  const collected = rankOf(s.map(p => ({ id: p.playerId, v: p.totalActualProduction })), playerId);
  if (onPaper === collected) {
    return `No. Your placements were worth ${ord(onPaper)} of ${n} in production, and you collected ${ord(collected)} of ${n}. Production, not points.`;
  }
  return collected > onPaper
    ? `Yes, against you. Your placements were worth ${ord(onPaper)} of ${n} in production; the dice left you ${ord(collected)}. Production, not points.`
    : `Yes, in your favour. Your placements were worth ${ord(onPaper)} of ${n} in production; the dice carried you to ${ord(collected)}. Production, not points.`;
}

// ─── Buildings and whose dice: one pass over the rolls ───────────────────────

interface RollLedger {
  /** production by building, per player */
  byBuilding: Map<string, Map<string, number>>;
  /** production received, per receiver, per thrower */
  byThrower: Map<string, Map<string, number>>;
}

function ledger(input: GameQuestionInput): RollLedger {
  const byBuilding = new Map<string, Map<string, number>>();
  const byThrower = new Map<string, Map<string, number>>();
  const events = input.exposureEvents as CatanPlayerExposureEvent[];
  const rolls = input.rollEvents
    .filter(r => !r.deletedAt && r.value !== 7)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  for (const p of input.players) {
    byBuilding.set(p.id, new Map());
    byThrower.set(p.id, new Map());
  }
  for (const roll of rolls) {
    for (const p of input.players) {
      const buildings = getBuildingStatesAtTurn(p.id, roll.turnNumber, events);
      if (buildings.length === 0) continue;
      const blocked = getActiveRobberBlockedNumbers(p.id, roll.turnNumber, events);
      let total = 0;
      const perBuilding = byBuilding.get(p.id)!;
      for (const b of buildings) {
        const got = netWeightForNumber([b], roll.value, blocked);
        if (got <= 0) continue;
        perBuilding.set(b.locationId, (perBuilding.get(b.locationId) ?? 0) + got);
        total += got;
      }
      if (total > 0) {
        const fed = byThrower.get(p.id)!;
        fed.set(roll.playerId, (fed.get(roll.playerId) ?? 0) + total);
      }
    }
  }
  return { byBuilding, byThrower };
}

function bestBuilding(input: GameQuestionInput, playerId: string, l: RollLedger): string | null {
  const produced = l.byBuilding.get(playerId);
  const standing = getBuildingStatesAtTurn(
    playerId, Number.MAX_SAFE_INTEGER, input.exposureEvents as CatanPlayerExposureEvent[]);
  if (standing.length === 0) return null;
  const rows = standing
    .map(b => ({ b, got: produced?.get(b.locationId) ?? 0 }))
    .sort((a, b) => b.got - a.got);
  const total = rows.reduce((s, r) => s + r.got, 0);
  if (total <= 0) return 'None of them produced anything.';

  const label = (r: (typeof rows)[number]) =>
    `your ${r.b.productionWeight >= 2 ? 'city' : 'settlement'} on ${describeCorner(r.b.locationId, r.b.affectedNumbers, input.hexes)}`;
  const top = rows[0]!;
  const share = Math.round((top.got / total) * 100);
  let answer = `${label(top).charAt(0).toUpperCase()}${label(top).slice(1)} brought in ${round(top.got)} — ${share}% of what your buildings collected.`;
  const last = rows[rows.length - 1]!;
  if (rows.length > 1 && last !== top) {
    answer += ` The least was ${label(last)}, with ${round(last.got)}.`;
  }
  return answer;
}

function fedBy(input: GameQuestionInput, playerId: string, l: RollLedger): string | null {
  const fed = l.byThrower.get(playerId);
  if (!fed || fed.size === 0) return 'Nobody. You collected nothing from any roll.';
  const total = [...fed.values()].reduce((s, v) => s + v, 0);
  const ranked = [...fed.entries()].sort((a, b) => b[1] - a[1]);
  const name = (id: string) =>
    id === playerId ? 'your own' : `${input.players.find(p => p.id === id)?.displayName ?? 'Someone'}'s`;
  const [topId, topValue] = ranked[0]!;
  const lead = `${name(topId).charAt(0).toUpperCase()}${name(topId).slice(1)} rolls paid you the most: ${round(topValue)} of your ${round(total)}.`;
  const rest = ranked.slice(1, 3).map(([id, v]) => `${name(id)} ${round(v)}`);
  return rest.length > 0 ? `${lead} Then ${rest.join(', ')}.` : lead;
}

// ─── Did my harbour match what I produced? ───────────────────────────────────

function harbourFit(input: GameQuestionInput, playerId: string): string | null {
  const stats = input.stats.find(s => s.playerId === playerId);
  if (!stats) return null;
  const ports = stats.portAccess;
  if (ports.length === 0) return 'You opened on no harbour, so every trade was at full price.';

  const player = input.players.find(p => p.id === playerId);
  const resources = player && input.hexes
    ? resourceExposure(player as Player, input.rollEvents, input.exposureEvents, input.hexes)
    : [];
  const collected = resources.reduce((s, r) => s + r.actual, 0);
  const ranked = [...resources].sort((a, b) => b.actual - a.actual);

  const lines = ports.map(port => {
    if (port === 'generic') {
      return collected > 0
        ? `Your 3:1 harbour covered all ${round(collected)} cards your buildings produced.`
        : 'You had a 3:1 harbour.';
    }
    if (resources.length === 0) return `You had a 2:1 ${port} harbour, but without a saved board the game cannot say how much ${port} you made.`;
    const made = resources.find(r => r.resource === port)?.actual ?? 0;
    const place = ranked.findIndex(r => r.resource === port) + 1;
    if (made <= 0) return `Your 2:1 ${port} harbour never had any ${port} of yours to trade.`;
    return place === 1
      ? `Your 2:1 ${port} harbour matched your best resource: ${round(made)} ${port}.`
      : `Your 2:1 ${port} harbour had ${round(made)} ${port} to work with, your ${ord(place)} most produced resource.`;
  });
  return lines.join(' ');
}

// ─── All of it ───────────────────────────────────────────────────────────────

/** Every answerable question, per player. Unanswerable ones are left out. */
export function answerGameQuestions(input: GameQuestionInput): Map<string, AnsweredQuestion[]> {
  const out = new Map<string, AnsweredQuestion[]>();
  const l = ledger(input);
  for (const p of input.players) {
    const answers: [QuestionKey, string | null][] = [
      ['robbed_by', robbedBy(input, p.id)],
      ['draft_picks', draftPicks(input, p.id)],
      ['average_dice', averageDice(input, p.id)],
      ['best_building', bestBuilding(input, p.id, l)],
      ['fed_by', fedBy(input, p.id, l)],
      ['harbour_fit', harbourFit(input, p.id)],
    ];
    out.set(
      p.id,
      answers
        .filter((a): a is [QuestionKey, string] => typeof a[1] === 'string' && a[1].length > 0)
        .map(([key, answer]) => ({ key, question: QUESTIONS[key], answer })),
    );
  }
  return out;
}

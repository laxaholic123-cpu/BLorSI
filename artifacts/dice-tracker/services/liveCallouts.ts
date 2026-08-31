/**
 * Things worth saying DURING the game, without saying anything untrue.
 *
 * WHY THIS IS NARROWER THAN IT LOOKS
 * ----------------------------------
 * "Surface the interesting thing as it happens" is multiple comparisons wearing
 * a party hat, and worse than the end-of-game version: checking after every
 * roll is SEQUENTIAL TESTING. A one-shot look at p<0.05 fires 5% of the time;
 * the same look repeated after each of eighty rolls fires far more often on
 * perfectly fair dice. This repo has already made the fixed-threshold mistake
 * three times — the ±15% band, the eleven-number breakdown, the ink cut — and
 * a live "you're unlucky!" toast is the fourth door into it.
 *
 * So every callout here is DESCRIPTIVE: a statement of what happened that is
 * true whatever the dice are doing. "Three 8s in a row" is a fact. "You're
 * running cold" is a claim, and claims live on the results screen where the
 * seeded Monte Carlo in `luckEngine` actually runs.
 *
 * The rules that keep it honest, all enforced below rather than by convention:
 *
 *   1. The candidate set is FIXED and declared as `CALLOUT_CATALOGUE`. Nothing
 *      is discovered by searching; each kind is written down in advance.
 *   2. At most ONE callout per roll, chosen by a fixed priority. A screen that
 *      can say three things at once will, and then everything is remarkable.
 *   3. A kind cannot repeat within `COOLDOWN_ROLLS`, so the same observation
 *      does not narrate itself every roll while it stays true.
 *   4. No probability, luck or skill words. There is a test for this.
 *
 * Everything here is a pure function of the log, so the same game always
 * produces the same callouts.
 */

import { CATAN_PROBS } from '@/services/catanStats';
import type { RollEvent } from '@/types/models';
import type { BoardSnapshot } from '@/services/catanBoardState';

/** How many rolls before the same KIND may be said again. */
export const COOLDOWN_ROLLS = 8;

/**
 * How many times its OWN expected gap a number must be absent to be worth a
 * mention.
 *
 * This was a flat 18 rolls, and measuring caught it: `number_drought` fired
 * once every 16 rolls, more than every other kind combined. A flat threshold
 * across eleven outcomes with different frequencies is not a threshold at all
 * — 18 rolls without a 6 is genuinely notable (its expected gap is 7.2), and
 * 18 rolls without a 2 is nothing whatever (expected gap 36).
 *
 * That is the SAME mistake as the ±15% production band and the eleven-number
 * breakdown, arriving for a fourth time through a new feature. Relative, never
 * absolute. Expected gap for a number is 1/p, so the bar is `MULT / p` rolls:
 * 18 for a 6 or 8, 90 for a 2 or 12.
 */
const DROUGHT_MULTIPLE = 2.5;

/** Sevens this close together get a mention. */
const SEVEN_WINDOW = 5;
const SEVEN_WINDOW_MIN = 3;

/** A run of the same number this long gets a mention. */
const STREAK_MIN = 3;

/** A stretch without a seven this long gets a mention. */
const NO_SEVEN_MIN = 15;

export type CalloutKind =
  | 'streak'
  | 'seven_cluster'
  | 'seven_drought'
  | 'number_drought'
  | 'first_sighting'
  | 'unowned_number'
  | 'blocked_hit'
  | 'full_house'
  | 'milestone';

export interface Callout {
  kind: CalloutKind;
  /** What to show. A fact, never a verdict. */
  text: string;
  /** Sequence number of the roll this describes, for cooldown bookkeeping. */
  sequenceNumber: number;
  /** Player the callout is about, when it is about one. */
  playerId?: string;
}

/**
 * Every callout this app can ever make, declared up front.
 *
 * The list being fixed is the whole point — see the header. Adding to it is a
 * deliberate act, not something that happens by tuning a threshold.
 */
export const CALLOUT_CATALOGUE: ReadonlyArray<{ kind: CalloutKind; describes: string }> = [
  { kind: 'streak', describes: 'the same number several times in a row' },
  { kind: 'seven_cluster', describes: 'several sevens close together' },
  { kind: 'seven_drought', describes: 'a long stretch with no seven' },
  { kind: 'number_drought', describes: 'a number absent for a long stretch' },
  { kind: 'first_sighting', describes: 'a number appearing for the first time, late' },
  { kind: 'unowned_number', describes: 'a number nobody has a building on' },
  { kind: 'blocked_hit', describes: 'a number that came up while blocked' },
  { kind: 'full_house', describes: 'every number from 2 to 12 has now appeared' },
  { kind: 'milestone', describes: 'a round number of rolls' },
];

export interface CalloutContext {
  rolls: readonly RollEvent[];
  /** Board positions, for the two board-aware callouts. Optional. */
  snapshot?: BoardSnapshot;
  /** Numbers currently blocked by the robber, per player. */
  blockedByPlayer?: ReadonlyMap<string, readonly number[]>;
  /** Display names, for callouts that mention somebody. */
  nameOf?: (playerId: string) => string;
  /** Kinds already used, kind → sequence number it last fired on. */
  recent?: ReadonlyMap<CalloutKind, number>;
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
};

/** Live rolls, oldest first. Deleted rolls never count — undo must undo. */
function liveRolls(rolls: readonly RollEvent[]): RollEvent[] {
  return rolls
    .filter(r => !r.deletedAt)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

/**
 * The one thing worth saying about the latest roll, or null.
 *
 * Candidates are generated in a FIXED priority order and the first that
 * survives the cooldown wins. Priority is by how specific the observation is:
 * something about this exact roll beats a running total.
 */
export function calloutForLatestRoll(ctx: CalloutContext): Callout | null {
  const rolls = liveRolls(ctx.rolls);
  if (rolls.length === 0) return null;
  const latest = rolls[rolls.length - 1]!;
  const seq = latest.sequenceNumber;
  const recent = ctx.recent ?? new Map<CalloutKind, number>();
  const name = (id: string) => ctx.nameOf?.(id) ?? 'Someone';

  const candidates: Callout[] = [];

  // 1. A run of the same number, ending on this roll.
  let run = 0;
  for (let i = rolls.length - 1; i >= 0; i--) {
    if (rolls[i]!.value === latest.value) run += 1;
    else break;
  }
  if (run >= STREAK_MIN) {
    candidates.push({
      kind: 'streak',
      sequenceNumber: seq,
      text: `${run} ${latest.value}s in a row.`,
    });
  }

  // 2. Sevens bunched together.
  if (latest.value === 7) {
    const window = rolls.slice(-SEVEN_WINDOW);
    const sevens = window.filter(r => r.value === 7).length;
    if (sevens >= SEVEN_WINDOW_MIN) {
      candidates.push({
        kind: 'seven_cluster',
        sequenceNumber: seq,
        text: `${sevens} sevens in the last ${window.length} rolls.`,
      });
    }
  }

  // 3. A seven after a long quiet stretch.
  if (latest.value === 7 && rolls.length > 1) {
    let gap = 0;
    for (let i = rolls.length - 2; i >= 0; i--) {
      if (rolls[i]!.value === 7) break;
      gap += 1;
    }
    if (gap >= NO_SEVEN_MIN) {
      candidates.push({
        kind: 'seven_drought',
        sequenceNumber: seq,
        text: `First seven in ${gap} rolls.`,
      });
    }
  }

  // 4. A number returning after a long absence.
  if (latest.value !== 7 && rolls.length > 1) {
    let gap = 0;
    for (let i = rolls.length - 2; i >= 0; i--) {
      if (rolls[i]!.value === latest.value) break;
      gap += 1;
    }
    const seenBefore = rolls.slice(0, -1).some(r => r.value === latest.value);
    const p = CATAN_PROBS[latest.value] ?? 0;
    const bar = p > 0 ? DROUGHT_MULTIPLE / p : Infinity;
    if (seenBefore && gap >= bar) {
      candidates.push({
        kind: 'number_drought',
        sequenceNumber: seq,
        text: `${latest.value} is back after ${gap} rolls.`,
      });
    }
    // 5. First time this number has shown at all, and we are well in.
    if (!seenBefore && rolls.length >= 20) {
      candidates.push({
        kind: 'first_sighting',
        sequenceNumber: seq,
        text: `First ${latest.value} of the game, on roll ${rolls.length}.`,
      });
    }
  }

  // 6. A number came up that nobody is standing on.
  if (ctx.snapshot && latest.value !== 7 && ctx.snapshot.buildings.size > 0) {
    const owned = new Set<number>();
    for (const b of ctx.snapshot.buildings.values()) {
      for (const n of b.affectedNumbers) owned.add(n);
    }
    if (!owned.has(latest.value)) {
      candidates.push({
        kind: 'unowned_number',
        sequenceNumber: seq,
        text: `Nobody is on ${latest.value}. That one paid out to no one.`,
      });
    }
  }

  // 7. A number came up while somebody was blocked on it.
  if (ctx.blockedByPlayer && latest.value !== 7) {
    for (const [playerId, numbers] of ctx.blockedByPlayer) {
      if (numbers.includes(latest.value)) {
        candidates.push({
          kind: 'blocked_hit',
          sequenceNumber: seq,
          playerId,
          text: `${name(playerId)} is blocked on ${latest.value}, and there it is.`,
        });
        break;
      }
    }
  }

  // 8. Every number has now appeared.
  const distinct = new Set(rolls.map(r => r.value));
  const before = new Set(rolls.slice(0, -1).map(r => r.value));
  const ALL = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (ALL.every(n => distinct.has(n)) && !ALL.every(n => before.has(n))) {
    candidates.push({
      kind: 'full_house',
      sequenceNumber: seq,
      text: `Every number from 2 to 12 has now come up.`,
    });
  }

  // 9. A round number of rolls.
  if (rolls.length >= 50 && rolls.length % 50 === 0) {
    candidates.push({
      kind: 'milestone',
      sequenceNumber: seq,
      text: `${ordinal(rolls.length)} roll of the game.`,
    });
  }

  for (const c of candidates) {
    const last = recent.get(c.kind);
    if (last !== undefined && seq - last < COOLDOWN_ROLLS) continue;
    return c;
  }
  return null;
}

/**
 * Fold a callout into the cooldown map.
 *
 * Kept separate so the caller owns the state; the generator stays pure.
 */
export function rememberCallout(
  recent: ReadonlyMap<CalloutKind, number>,
  callout: Callout,
): Map<CalloutKind, number> {
  const next = new Map(recent);
  next.set(callout.kind, callout.sequenceNumber);
  return next;
}

/**
 * Replay a whole log, honouring the cooldown, as the game would have produced.
 *
 * Used by the results screen to show the game's callouts back, and by tests to
 * check the rate over a realistic session.
 */
export function calloutsForSession(ctx: CalloutContext): Callout[] {
  const rolls = liveRolls(ctx.rolls);
  const out: Callout[] = [];
  let recent = new Map<CalloutKind, number>();
  for (let i = 1; i <= rolls.length; i++) {
    const c = calloutForLatestRoll({ ...ctx, rolls: rolls.slice(0, i), recent });
    if (c) {
      out.push(c);
      recent = rememberCallout(recent, c);
    }
  }
  return out;
}

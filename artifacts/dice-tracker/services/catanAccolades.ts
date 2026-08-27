/**
 * One accolade per player, on a distinct axis, with their PLACE on it stated.
 *
 * WHY THIS EXISTS
 * ---------------
 * The end-of-game verdict produces one of two headlines and a paragraph of
 * boilerplate that names nobody. Played through six simulated games it said
 * "The dice were fair" or "A mixed picture", word for word, every time — while
 * the numbers underneath held things like "luckier than 94% of fair games with
 * this board" and "lost 4 production to the robber, most at the table". The
 * facts were computed and then discarded.
 *
 * TWO DESIGN RULES, BOTH LEARNED THE HARD WAY
 * -------------------------------------------
 * **Every player gets one, and no two share.** A naive pass — take each
 * superlative, name its winner — gave three of six badges to one player and
 * left two players with nothing. A results screen that spotlights one person is
 * worse than one that names nobody, because now the table can see who was left
 * out. So this is an ASSIGNMENT problem: `hungarian`, the same solver the board
 * reader uses to fit readings to the token bag, pairs players to axes so the
 * table as a whole is most interesting.
 *
 * **Every place is reportable, not just first.** An axis is not a prize for its
 * winner; it is a ranking everybody appears on. Coming SECOND in production
 * luck out of five is a fact worth reading, and last place is often the best
 * story at the table. Each accolade therefore states the player's rank, and a
 * player can be assigned an axis they did not win.
 *
 * WHAT MAKES ONE HONEST
 * ---------------------
 * Every accolade carries a real number and a real position. "Luckiest" with no
 * figure is a horoscope; "2nd of 4, ahead of 78% of fair games with your
 * placements" is a measurement. Axes that depend on the simulation are withheld
 * entirely when it did not run, rather than silently falling back to a raw
 * percentage — the same percentage means very different things at 40 rolls and
 * 150, which is why the percentile exists.
 */

import { hungarian } from '@/services/boardConstraints';
import {
  getActiveRobberBlockedNumbers,
  getBuildingStatesAtTurn,
  netWeightForNumber,
} from '@/services/catanStats';
import { DEV_DECK_COMPOSITION, DEV_DECK_SIZE } from '@/services/devCards';
import type {
  CatanDevCardEvent,
  CatanPlayerExposureEvent,
  RollEvent,
} from '@/types/models';
import type { CatanPlayerProductionStats } from '@/types/catanStats';

/**
 * What each player's own DICE did, as opposed to what their placements earned.
 *
 * None of this was previously computed anywhere. The roll log knows who threw
 * every number, and that is a whole dimension of table story — who fed the
 * table, who starved it, whose turn everybody dreaded — that the production
 * stats cannot see because they only care which numbers came up, not who
 * threw them.
 */
export interface PlayerRollProfile {
  playerId: string;
  rolls: number;
  sevens: number;
  /** Mean of every roll this player threw. */
  mean: number;
  /** Longest run of the SAME value thrown consecutively by this player. */
  longestRepeat: number;
  /** Production this player's own throws handed to everyone else. */
  gaveToOthers: number;
  /** Production this player's own throws handed to themselves. */
  keptForSelf: number;
  /** Times they threw the table's rarest outcomes. */
  twos: number;
  twelves: number;
  /** Throws that showed the same value on both dice, when dice were recorded. */
  doubles: number;

  // ── What the deck gave them ───────────────────────────────────────────────
  /** Development cards drawn, ignoring undone draws. */
  draws: number;
  knights: number;
  /** Victory-point cards: the deck's scarcest prize at 5 of 25. */
  vpCards: number;
  /** Monopoly, Year of Plenty and Road Building together. */
  actionCards: number;
  /**
   * VP cards drawn minus the number a fair deck owed them, in cards.
   *
   * The dev deck is fixed and known — 14 knights, 5 victory points, 2 each of
   * the rest — so draw luck is measurable against expectation in exactly the
   * way production luck is, rather than being a vibe.
   */
  vpDrawLuck: number;
  knightDrawLuck: number;

  // ── How the game actually went ────────────────────────────────────────────
  /** Most production taken from a single roll. */
  bestTurn: number;
  /** Longest run of consecutive rolls that paid them nothing at all. */
  longestDrought: number;
  /** Production in the first half of the game, and in the second. */
  earlyProduction: number;
  lateProduction: number;
  /** Turn of their first city, or null if they never built one. */
  firstCityTurn: number | null;
  /** Buildings added after the opening placement. */
  expansions: number;
}

export type AccoladeKind = string;

export interface Accolade {
  playerId: string;
  displayName: string;
  /** Stable id for the axis, e.g. 'robber_losses'. */
  kind: AccoladeKind;
  /** Two or three words, safe as a badge. Varies with their place. */
  title: string;
  /** One line carrying the real number AND their rank. */
  detail: string;
  /** 1 = best on this axis. */
  rank: number;
  outOf: number;
  /** How notable this pairing is, 0-1. Lets a caller show only strong ones. */
  strength: number;
}

interface Ctx {
  players: CatanPlayerProductionStats[];
  profiles: Map<string, PlayerRollProfile>;
}

/**
 * An axis everybody is ranked on.
 *
 * `value` may return null when the axis cannot speak about a player at all —
 * a percentile axis with no simulation, a harbour axis for a player with no
 * ports. Those players are simply not ranked on it.
 */
interface Axis {
  kind: string;
  /**
   * Tie-break weight, ~0.9 to 1.1.
   *
   * With four players every axis has two players at either end, so almost
   * everything ties at maximum interest and the solver picks by column order —
   * which meant the same two axes appeared in nearly every game while the most
   * novel ones never did.
   *
   * The ordering principle: prefer what the table CANNOT already read off the
   * board or the stats panel. "Their throws paid everyone else 40 production"
   * is invisible without this app; "collected the most production" is on screen
   * already.
   */
  weight?: number;
  /** Title for the leader, then for the middle, then for last. */
  titles: [string, string, string];
  value: (p: CatanPlayerProductionStats, c: Ctx) => number | null;
  /** True when a LOW value is the notable end. */
  lowIsInteresting?: boolean;
  detail: (p: CatanPlayerProductionStats, c: Ctx, rank: number, outOf: number) => string;
}

const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? 'th';
  return `${n}${s}`;
};
const place = (rank: number, outOf: number) => `${ord(rank)} of ${outOf}`;
const pctStr = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;
const prof = (p: CatanPlayerProductionStats, c: Ctx) => c.profiles.get(p.playerId);

// ─── The axes ────────────────────────────────────────────────────────────────
//
// Roughly half come from placements and production, half from the roll log.
// The roll half is entirely new: nothing else in the app looks at WHO threw a
// number, only at which numbers came up.

const AXES: Axis[] = [
  {
    kind: 'luck_percentile',
    weight: 1.005,
    titles: ['Dice Whisperer', 'Fairly Treated', 'Robbed by Physics'],
    value: p => p.productionLuckPercentile ?? null,
    detail: (p, _c, r, n) => `Out-produced ${Math.round(p.productionLuckPercentile!)}% of `
      + `fair games with the same placements — ${place(r, n)} for luck.`,
  },
  {
    kind: 'production_delta',
    weight: 0.995,
    titles: ['Punched Above', 'On The Nose', 'Deserved Better'],
    value: p => p.productionLuckPct,
    detail: (p, _c, r, n) => `Took ${pctStr(p.productionLuckPct)} against what the `
      + `placements promised, ${place(r, n)} at the table.`,
  },
  {
    kind: 'robber_losses',
    weight: 1.005,
    titles: ['Robber Magnet', 'Occasionally Robbed', 'Untouchable'],
    value: p => p.robberLostProduction,
    detail: (p, _c, r, n) => p.robberLostProduction > 0
      ? `Lost ${p.robberLostProduction.toFixed(0)} production to the robber — ${place(r, n)} most robbed.`
      : `The robber never cost them a thing.`,
  },
  {
    kind: 'placement_strength',
    weight: 0.995,
    titles: ['Prime Real Estate', 'Decent Corner', 'Humble Beginnings'],
    value: p => p.placementStrength,
    detail: (p, _c, r, n) => `Opening worth ${p.placementStrength.toFixed(2)} weighted pips, `
      + `${place(r, n)} on the board.`,
  },
  {
    kind: 'number_diversity',
    weight: 1.000,
    titles: ['Diversified', 'Balanced Spread', 'All In'],
    value: p => p.numberDiversity,
    detail: (p, _c, r, n) => `Exposed to ${p.numberDiversity} different numbers, `
      + `${place(r, n)} widest spread.`,
  },
  {
    kind: 'cities',
    weight: 0.990,
    titles: ['Concrete Poet', 'Broke Ground', 'Still Renting'],
    value: p => p.finalCityCount,
    detail: (p, _c, r, n) => p.finalCityCount > 0
      ? `Built ${p.finalCityCount} ${p.finalCityCount === 1 ? 'city' : 'cities'}, ${place(r, n)}.`
      : `Never upgraded a settlement all game.`,
  },
  {
    kind: 'expected_engine',
    weight: 0.985,
    titles: ['Engine Room', 'Steady Income', 'Living Thin'],
    value: p => p.totalExpectedProduction,
    detail: (p, _c, r, n) => `Placements were worth ${p.totalExpectedProduction.toFixed(0)} `
      + `production on paper, ${place(r, n)}.`,
  },
  {
    kind: 'actual_output',
    weight: 0.980,
    titles: ['Top Producer', 'Middle of the Pack', 'Lean Season'],
    value: p => p.totalActualProduction,
    detail: (p, _c, r, n) => `Actually collected ${p.totalActualProduction.toFixed(0)} `
      + `production, ${place(r, n)}.`,
  },
  {
    kind: 'harbours',
    weight: 1.010,
    titles: ['Harbour Master', 'Coastal', 'Landlocked'],
    // Ports never enter production maths — they change trade rates — so they
    // are their own axis rather than folded into placement strength.
    value: p => p.portAccess.length,
    detail: (p, _c, r, n) => p.portAccess.length > 0
      ? `Opened on ${p.portAccess.length} ${p.portAccess.length === 1 ? 'harbour' : 'harbours'}, `
        + `${place(r, n)} — trade rates the others did not have.`
      : `No harbour access at all. Every trade at full price.`,
  },
  {
    kind: 'buildings',
    weight: 0.975,
    titles: ['Land Grab', 'Settled In', 'Travelling Light'],
    value: p => p.initialBuildingCount,
    detail: (p, _c, r, n) => `Started with ${p.initialBuildingCount} `
      + `${p.initialBuildingCount === 1 ? 'settlement' : 'settlements'}, ${place(r, n)}.`,
  },
  // ── From the roll log ──────────────────────────────────────────────────────
  {
    kind: 'sevens_thrown',
    weight: 1.010,
    titles: ['Seven Sender', 'Occasional Menace', 'Kept The Peace'],
    value: (p, c) => prof(p, c)?.sevens ?? null,
    detail: (p, c, r, n) => `Threw ${prof(p, c)!.sevens} sevens, ${place(r, n)} — `
      + `every one of them moved the robber.`,
  },
  {
    kind: 'mean_roll',
    weight: 1.005,
    titles: ['Rolls Big', 'Dead Average', 'Rolls Small'],
    value: (p, c) => prof(p, c)?.mean ?? null,
    detail: (p, c, r, n) => `Averaged ${prof(p, c)!.mean.toFixed(1)} per throw against `
      + `a fair 7.0, ${place(r, n)} highest.`,
  },
  {
    kind: 'gave_to_others',
    weight: 1.025,
    titles: ['Table Philanthropist', 'Fair Dealer', 'Feeds Nobody'],
    // Nothing else in the app knows this: which player's turns actually paid
    // everyone ELSE. It is the most social number available.
    value: (p, c) => prof(p, c)?.gaveToOthers ?? null,
    detail: (p, c, r, n) => `Their throws handed ${prof(p, c)!.gaveToOthers.toFixed(0)} `
      + `production to everyone else, ${place(r, n)} most generous.`,
  },
  {
    kind: 'kept_for_self',
    weight: 1.020,
    titles: ['Self-Serving', 'Even-Handed', 'Rolls For Others'],
    value: (p, c) => prof(p, c)?.keptForSelf ?? null,
    detail: (p, c, r, n) => `${prof(p, c)!.keptForSelf.toFixed(0)} of their own production `
      + `came off their own throws, ${place(r, n)}.`,
  },
  {
    kind: 'longest_repeat',
    weight: 1.015,
    titles: ['Broken Record', 'Mildly Repetitive', 'Never Repeats'],
    value: (p, c) => prof(p, c)?.longestRepeat ?? null,
    detail: (p, c, r, n) => `Threw the same number ${prof(p, c)!.longestRepeat} times in a `
      + `row at one point, ${place(r, n)} longest streak.`,
  },
  {
    kind: 'extremes_thrown',
    weight: 1.012,
    titles: ['Boxcars & Snake Eyes', 'Occasional Extreme', 'Stays Central'],
    value: (p, c) => {
      const pr = prof(p, c);
      return pr ? pr.twos + pr.twelves : null;
    },
    detail: (p, c, r, n) => {
      const pr = prof(p, c)!;
      return `Threw ${pr.twos + pr.twelves} of the rarest results `
        + `(${pr.twos} snake eyes, ${pr.twelves} boxcars), ${place(r, n)}.`;
    },
  },
  {
    kind: 'rolls_taken',
    weight: 0.975,
    titles: ['Marathon Turn Count', 'Standard Innings', 'Short Game'],
    value: (p, c) => prof(p, c)?.rolls ?? null,
    detail: (p, c, r, n) => `Threw the dice ${prof(p, c)!.rolls} times, ${place(r, n)}.`,
  },
  // ── What the development deck gave them ───────────────────────────────────
  //
  // The deck is fixed and known — 14 knights, 5 victory points, 2 each of the
  // rest — so draw luck is measurable against expectation exactly the way
  // production luck is, instead of being a feeling about whether the cards
  // were kind.
  {
    kind: 'vp_draw_luck',
    weight: 1.025,
    titles: ['Deck Darling', 'Fair Draws', 'Nothing But Knights'],
    value: (p, c) => {
      const pr = prof(p, c);
      return pr && pr.draws > 0 ? pr.vpDrawLuck : null;
    },
    detail: (p, c, r, n) => {
      const pr = prof(p, c)!;
      const owed = pr.draws * 0.2;
      return `Drew ${pr.vpCards} victory point ${pr.vpCards === 1 ? 'card' : 'cards'} `
        + `from ${pr.draws}, against ${owed.toFixed(1)} a fair deck owed them — ${place(r, n)}.`;
    },
  },
  {
    kind: 'knights',
    weight: 1.015,
    titles: ['Standing Army', 'Some Muscle', 'Pacifist'],
    value: (p, c) => prof(p, c)?.knights ?? null,
    detail: (p, c, r, n) => `Pulled ${prof(p, c)!.knights} `
      + `${prof(p, c)!.knights === 1 ? 'knight' : 'knights'} out of the deck, ${place(r, n)}.`,
  },
  {
    kind: 'action_cards',
    weight: 1.02,
    titles: ['Trick Deck', 'A Card Or Two', 'Straight Bat'],
    value: (p, c) => prof(p, c)?.actionCards ?? null,
    detail: (p, c, r, n) => `Drew ${prof(p, c)!.actionCards} of the six scheming cards — `
      + `monopoly, year of plenty, road building — ${place(r, n)}.`,
  },
  {
    kind: 'draws',
    weight: 0.99,
    titles: ['Deck Diver', 'Bought A Few', 'Never Bought In'],
    value: (p, c) => prof(p, c)?.draws ?? null,
    detail: (p, c, r, n) => `Bought ${prof(p, c)!.draws} development `
      + `${prof(p, c)!.draws === 1 ? 'card' : 'cards'}, ${place(r, n)}.`,
  },
  // ── The shape of their game, not just its total ───────────────────────────
  //
  // Two players can finish on the same production having had completely
  // different games. Totals cannot tell them apart; these can.
  {
    kind: 'longest_drought',
    weight: 1.03,
    titles: ['Wandered The Desert', 'Some Dry Spells', 'Never Went Hungry'],
    value: (p, c) => prof(p, c)?.longestDrought ?? null,
    detail: (p, c, r, n) => `Went ${prof(p, c)!.longestDrought} consecutive rolls without `
      + `producing anything — ${place(r, n)} longest drought.`,
  },
  {
    kind: 'best_turn',
    weight: 1.02,
    titles: ['One Big Score', 'Solid Peak', 'Never Spiked'],
    value: (p, c) => prof(p, c)?.bestTurn ?? null,
    detail: (p, c, r, n) => `Best single roll paid them ${prof(p, c)!.bestTurn.toFixed(0)} `
      + `production, ${place(r, n)}.`,
  },
  {
    kind: 'late_surge',
    weight: 1.025,
    titles: ['Strong Finisher', 'Even Throughout', 'Faded Late'],
    // Positive means the back half paid better than the front half.
    value: (p, c) => {
      const pr = prof(p, c);
      return pr ? pr.lateProduction - pr.earlyProduction : null;
    },
    detail: (p, c, r, n) => {
      const pr = prof(p, c)!;
      const d = pr.lateProduction - pr.earlyProduction;
      return `${pr.earlyProduction.toFixed(0)} production in the first half, `
        + `${pr.lateProduction.toFixed(0)} in the second — `
        + `${d >= 0 ? 'grew into' : 'faded out of'} the game, ${place(r, n)}.`;
    },
  },
  {
    kind: 'first_city',
    weight: 1.01,
    titles: ['First To Build Up', 'Upgraded In Time', 'Slow To Build'],
    // Earlier is better, so the ranking runs the other way.
    lowIsInteresting: true,
    value: (p, c) => prof(p, c)?.firstCityTurn ?? null,
    detail: (p, c, r, n) => `First city on turn ${prof(p, c)!.firstCityTurn}, ${place(r, n)} `
      + `to upgrade.`,
  },
  {
    kind: 'expansions',
    weight: 1.0,
    titles: ['Kept Building', 'Grew A Little', 'Stood Still'],
    value: (p, c) => prof(p, c)?.expansions ?? null,
    detail: (p, c, r, n) => `Added ${prof(p, c)!.expansions} `
      + `${prof(p, c)!.expansions === 1 ? 'building' : 'buildings'} after the opening, `
      + `${place(r, n)}.`,
  },
  {
    kind: 'doubles',
    weight: 1.01,
    titles: ['Seeing Double', 'The Odd Pair', 'Never Doubles'],
    // Only speaks when the player recorded both dice; that setting is off by
    // default, so most sessions skip this axis entirely rather than report a
    // table of zeroes.
    value: (p, c) => {
      const pr = prof(p, c);
      return pr && pr.doubles > 0 ? pr.doubles : null;
    },
    detail: (p, c, r, n) => `Threw ${prof(p, c)!.doubles} doubles, ${place(r, n)}.`,
  },
];

/**
 * Every accolade the engine can hand out, for tests and for documentation.
 *
 * Each axis yields three readings depending on where a player landed on it, so
 * the catalogue is three times the axis count.
 */
export const ACCOLADE_CATALOGUE: ReadonlyArray<{ kind: string; titles: string[] }> =
  AXES.map(a => ({ kind: a.kind, titles: [...a.titles] }));

/** Total distinct accolades a player might see. */
export const ACCOLADE_COUNT = AXES.length * 3;

/**
 * Summarise what each player's own dice did.
 *
 * `gaveToOthers` and `keptForSelf` re-run the same production model the stats
 * use, so a robber block active at the time is respected — a throw that hit a
 * blocked hex paid nobody, and saying otherwise would be a nicer story and a
 * false one.
 */
export function profileRolls(
  players: readonly { id: string }[],
  rollEvents: readonly RollEvent[],
  exposureEvents: readonly CatanPlayerExposureEvent[],
  devCardEvents: readonly CatanDevCardEvent[] = [],
): Map<string, PlayerRollProfile> {
  const live = rollEvents.filter(r => !r.deletedAt);
  const out = new Map<string, PlayerRollProfile>();

  for (const player of players) {
    const mine = live.filter(r => r.playerId === player.id)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    let longest = 0;
    let run = 0;
    let previous: number | null = null;
    for (const r of mine) {
      run = r.value === previous ? run + 1 : 1;
      previous = r.value;
      if (run > longest) longest = run;
    }
    const draws = devCardEvents.filter(d => d.playerId === player.id && !d.deletedAt);
    const knights = draws.filter(d => d.cardType === 'knight').length;
    const vp = draws.filter(d => d.cardType === 'victoryPoint').length;

    out.set(player.id, {
      playerId: player.id,
      rolls: mine.length,
      sevens: mine.filter(r => r.value === 7).length,
      mean: mine.length ? mine.reduce((s, r) => s + r.value, 0) / mine.length : 0,
      longestRepeat: longest,
      twos: mine.filter(r => r.value === 2).length,
      twelves: mine.filter(r => r.value === 12).length,
      // Only counted when the player recorded both dice; the setting is off by
      // default, so this axis simply does not speak for most sessions.
      doubles: mine.filter(r => r.individualDiceValues?.length === 2
        && r.individualDiceValues[0] === r.individualDiceValues[1]).length,
      draws: draws.length,
      knights,
      vpCards: vp,
      actionCards: draws.length - knights - vp,
      // Against what the known 25-card deck owed them for that many draws.
      vpDrawLuck: vp - draws.length * (DEV_DECK_COMPOSITION.victoryPoint / DEV_DECK_SIZE),
      knightDrawLuck: knights - draws.length * (DEV_DECK_COMPOSITION.knight / DEV_DECK_SIZE),
      gaveToOthers: 0,
      keptForSelf: 0,
      bestTurn: 0,
      longestDrought: 0,
      earlyProduction: 0,
      lateProduction: 0,
      firstCityTurn: null,
      expansions: 0,
    });
  }

  // When did each player first build a city, and how much did they expand?
  for (const player of players) {
    const theirs = exposureEvents
      .filter(e => e.playerId === player.id)
      .sort((a, b) => a.turnNumber - b.turnNumber);
    const firstCity = theirs.find(e => e.eventType === 'cityUpgrade');
    const p = out.get(player.id)!;
    p.firstCityTurn = firstCity ? firstCity.turnNumber : null;
    p.expansions = theirs.filter(
      e => e.eventType === 'settlementBuilt' || e.eventType === 'cityUpgrade',
    ).length;
  }

  /**
   * Per-player production, roll by roll, so the SHAPE of their game is visible
   * and not just its total.
   *
   * A player who took 60 production in three enormous turns and nothing in
   * between had a completely different game from one who took 60 evenly, and
   * the totals cannot tell them apart. This is what droughts and big turns are
   * read from.
   */
  const timeline = new Map<string, number[]>(players.map(p => [p.id, []]));

  // Who did each throw actually pay? Walk every roll once and credit the
  // thrower for what it produced, split between them and the rest of the table.
  const ordered = [...live].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  for (const roll of ordered) {
    for (const player of players) {
      if (roll.value === 7) {
        timeline.get(player.id)!.push(0);
        continue;
      }
      const buildings = getBuildingStatesAtTurn(player.id, roll.turnNumber, exposureEvents as CatanPlayerExposureEvent[]);
      if (buildings.length === 0) continue;
      const blocked = getActiveRobberBlockedNumbers(player.id, roll.turnNumber, exposureEvents as CatanPlayerExposureEvent[]);
      const paid = buildings.length === 0
        ? 0 : netWeightForNumber(buildings, roll.value, blocked);
      timeline.get(player.id)!.push(paid);
      if (paid <= 0) continue;
      const thrower = out.get(roll.playerId);
      if (!thrower) continue;
      if (player.id === roll.playerId) thrower.keptForSelf += paid;
      else thrower.gaveToOthers += paid;
    }
  }

  for (const player of players) {
    const series = timeline.get(player.id)!;
    const p = out.get(player.id)!;
    let drought = 0;
    let worst = 0;
    for (const amount of series) {
      if (amount > 0) {
        drought = 0;
      } else {
        drought += 1;
        if (drought > worst) worst = drought;
      }
      if (amount > p.bestTurn) p.bestTurn = amount;
    }
    p.longestDrought = worst;
    const half = Math.floor(series.length / 2);
    p.earlyProduction = series.slice(0, half).reduce((a, b) => a + b, 0);
    p.lateProduction = series.slice(half).reduce((a, b) => a + b, 0);
  }
  return out;
}

/**
 * Give every player exactly one accolade, on a distinct axis, stating where
 * they placed on it.
 *
 * Returned in the order the players were supplied, so a caller can lay them out
 * beside the existing per-player stats without re-sorting.
 */
export function assignAccolades(
  players: readonly CatanPlayerProductionStats[],
  profiles: Map<string, PlayerRollProfile> = new Map(),
): Accolade[] {
  const all = [...players];
  if (all.length === 0) return [];
  const ctx: Ctx = { players: all, profiles };

  /** Rank every player on every axis, best first. */
  const ranked = AXES.map(axis => {
    const scored = all
      .map(p => ({ p, v: axis.value(p, ctx) }))
      .filter((e): e is { p: CatanPlayerProductionStats; v: number } => e.v !== null);
    scored.sort((a, b) => axis.lowIsInteresting ? a.v - b.v : b.v - a.v);
    const rank = new Map<string, number>();
    const values = new Map<string, number>();
    scored.forEach((e, i) => {
      rank.set(e.p.playerId, i + 1);
      values.set(e.p.playerId, e.v);
    });
    return { axis, rank, values, outOf: scored.length, spread: scored.length > 1
      ? Math.abs(scored[0]!.v - scored[scored.length - 1]!.v) : 0 };
  });

  /**
   * How interesting is this player on this axis?
   *
   * Extremes carry the story, so both ends score well and the middle does not —
   * but the middle is never zero, because a full assignment must always exist
   * and "3rd of 5 for production" is still a true, readable sentence.
   */
  function interest(rowIdx: number, axisIdx: number): number {
    const { axis, rank, outOf, spread, values } = ranked[axisIdx]!;
    const p = all[rowIdx]!;
    const r = rank.get(p.playerId);
    if (r === undefined) return 0;
    if (outOf === 1) return 0.3;

    const fromEnd = Math.min(r - 1, outOf - r) / ((outOf - 1) / 2);
    const extremity = 1 - fromEnd;               // 1 at either end, 0 mid-pack

    /**
     * How far clear of the next player they are, as a share of the whole
     * spread.
     *
     * Without this, four players make almost every axis tie at maximum
     * extremity — ranks 1 and 4 both score 1.0 — and the choice falls to the
     * tie-break weights, which made the SAME axes appear in every game. Leading
     * by a mile is a better story than leading by a hair, and that varies game
     * to game, so it is both more honest and more varied.
     */
    const mine = values.get(p.playerId)!;
    const neighbourRank = r === 1 ? 2 : r === outOf ? outOf - 1 : (r < outOf ? r + 1 : r - 1);
    const neighbour = [...values.entries()]
      .find(([id]) => rank.get(id) === neighbourRank)?.[1];
    const gap = neighbour === undefined || spread <= 0
      ? 0 : Math.abs(mine - neighbour) / spread;
    const decisiveness = 0.45 + 0.55 * Math.min(1, gap * 2);

    // An axis where everybody scored the same is not a story about anyone.
    const separated = spread > 0 ? 1 : 0.15;
    const base = 0.12 + 0.88 * extremity * decisiveness * separated;
    return base * (axis.weight ?? 1);
  }

  const IMPOSSIBLE = 100;
  const cost = all.map((_p, row) =>
    ranked.map((_a, col) => {
      const i = interest(row, col);
      return i <= 0 ? IMPOSSIBLE : 1 - i;
    }),
  );
  const assignment = hungarian(cost);

  return all.map((p, row) => {
    let col = assignment[row] ?? -1;
    if (col < 0 || ranked[col]!.rank.get(p.playerId) === undefined) {
      // More players than axes that can speak about them: fall back to the
      // first axis that CAN, rather than emit an empty badge.
      col = ranked.findIndex(r => r.rank.get(p.playerId) !== undefined);
    }
    const { axis, rank, outOf } = ranked[col]!;
    const r = rank.get(p.playerId)!;
    // Leader, mid-pack, or last — the title follows the placing.
    const title = r === 1 ? axis.titles[0]
      : r === outOf ? axis.titles[2]
      : axis.titles[1];
    return {
      playerId: p.playerId,
      displayName: p.displayName,
      kind: axis.kind,
      title,
      detail: axis.detail(p, ctx, r, outOf),
      rank: r,
      outOf,
      strength: Math.min(1, interest(row, col)),
    };
  });
}

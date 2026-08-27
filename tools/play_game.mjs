/**
 * Play a full Catan session through the real services and print what a player
 * would actually see.
 *
 * The vision path has been measured to death. The GAME path — rolls, exposure,
 * production luck, the verdict and its accolades — has never run end to end,
 * on a device or anywhere else. This drives the shipping modules with a whole
 * session's worth of realistic events and prints the result, so the output can
 * be read the way a player would read it.
 *
 * Deliberately not a unit test. Unit tests check that a function returns what
 * it promised; this checks whether what it promised is worth reading.
 *
 *   node tools/play_game.mjs [seed]
 */
import {
  computeCatanGameStats,
} from '../artifacts/dice-tracker/dist-game/catanStats.js';
import {
  generateBoard,
} from '../artifacts/dice-tracker/dist-game/boardGenerator.js';
import {
  getAllIntersections,
} from '../artifacts/dice-tracker/dist-game/catanBoard.js';

const SEED = Number(process.argv[2] ?? 12345);

/** Reproducible RNG, same mulberry32 the app's generator uses. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);
const roll2d6 = () => (1 + Math.floor(rng() * 6)) + (1 + Math.floor(rng() * 6));

// ── Set up a real board and a real four-player session ───────────────────────
// generateBoard takes a SEED, not an rng — passing { rng } silently fell back
// to Math.random() and made every run different.
const board = generateBoard({ seed: SEED, desertCentre: false, balancedNumbers: true });
const hexes = board.hexes ?? board.layout?.hexes ?? board;

const PLAYERS = ['Alex', 'Bo', 'Cass', 'Dre'].map((displayName, i) => ({
  id: `p${i + 1}`,
  displayName,
  color: ['#F5A623', '#4A90D9', '#7ED321', '#D0021B'][i],
  seatNumber: i + 1,
  createdAt: new Date(2026, 7, 25).toISOString(),
}));

const session = {
  id: 'sim-1',
  gameType: 'catan',
  diceMode: '2D6',
  minimumRoll: 2,
  maximumRoll: 12,
  players: PLAYERS,
  currentPlayerIndex: 0,
  autoAdvancePlayer: true,
  startedAt: new Date(2026, 7, 25, 19, 0).toISOString(),
  status: 'active',
  settings: {
    recordIndividualDice: false,
    catanTrackExposure: true,
    catanTrackDevCards: false,
  },
  schemaVersion: 1,
};

// ── Initial placement: two settlements each, at real intersections ───────────
const intersections = getAllIntersections();
const usable = intersections.filter(
  it => (it.hexIndices ?? it.hexes ?? []).length >= 2,
);

const exposure = [];
let evId = 0;
const taken = new Set();

function numbersAt(it) {
  const idx = it.hexIndices ?? it.hexes ?? [];
  return idx
    .map(i => hexes[i]?.number)
    .filter(n => typeof n === 'number' && n !== null);
}

for (const player of PLAYERS) {
  for (let s = 0; s < 2; s++) {
    // Pick an unused intersection that actually produces something.
    let pick = null;
    for (let attempt = 0; attempt < 200; attempt++) {
      const cand = usable[Math.floor(rng() * usable.length)];
      const key = cand.id ?? JSON.stringify(cand);
      if (taken.has(key)) continue;
      if (numbersAt(cand).length === 0) continue;
      taken.add(key);
      pick = cand;
      break;
    }
    if (!pick) continue;
    exposure.push({
      id: `e${evId++}`,
      sessionId: session.id,
      playerId: player.id,
      eventType: 'initialSettlement',
      turnNumber: 0,
      timestamp: session.startedAt,
      // REQUIRED. getBuildingStatesAtTurn keys buildings by hexIdentifiers[0]
      // and silently skips any event without one.
      hexIdentifiers: [pick.id],
      affectedNumbers: numbersAt(pick),
      productionWeight: 1,
      robberBlocked: false,
    });
  }
}

// ── Play ~22 rounds, with cities and robber blocks along the way ─────────────
const rolls = [];
let seq = 0;
let robberOn = null;
const TURNS = 22;
for (let turn = 1; turn <= TURNS; turn++) {
  for (const player of PLAYERS) {
    const value = roll2d6();
    rolls.push({
      id: `r${seq}`,
      sessionId: session.id,
      playerId: player.id,
      value,
      turnNumber: turn,
      sequenceNumber: seq++,
      timestamp: new Date(2026, 7, 25, 19, Math.floor(seq / 2)).toISOString(),
      source: 'touchscreen',
    });

    // A 7 moves the robber. Clear whatever it was on, then block someone new —
    // the reader tracks blocks by hexIdentifier, so both halves are required or
    // a block never ends.
    if (value === 7 && turn > 2) {
      if (robberOn) {
        exposure.push({
          ...robberOn,
          id: `e${evId++}`,
          eventType: 'robberBlockEnded',
          turnNumber: turn,
          robberBlocked: false,
        });
        robberOn = null;
      }
      const victim = PLAYERS[Math.floor(rng() * PLAYERS.length)];
      const theirs = exposure.filter(
        e => e.playerId === victim.id && e.eventType === 'initialSettlement',
      );
      const hit = theirs[Math.floor(rng() * theirs.length)];
      if (hit && hit.affectedNumbers.length) {
        const blockedNumber = hit.affectedNumbers[Math.floor(rng() * hit.affectedNumbers.length)];
        robberOn = {
          ...hit,
          hexIdentifiers: [`hex-${blockedNumber}-${victim.id}`],
          affectedNumbers: [blockedNumber],
        };
        exposure.push({
          ...robberOn,
          id: `e${evId++}`,
          eventType: 'robberBlockStarted',
          turnNumber: turn,
          robberBlocked: true,
        });
      }
    }

    // Somebody upgrades to a city every few turns.
    if (turn > 4 && rng() < 0.12) {
      const theirs = exposure.filter(
        e => e.playerId === player.id && e.eventType === 'initialSettlement',
      );
      const up = theirs[Math.floor(rng() * theirs.length)];
      if (up) {
        exposure.push({
          ...up,
          id: `e${evId++}`,
          eventType: 'cityUpgrade',
          turnNumber: turn,
          productionWeight: 2,
          robberBlocked: false,
        });
      }
    }
  }
}

// ── What does the player see? ────────────────────────────────────────────────
const stats = computeCatanGameStats(session, rolls, exposure, { simulate: true });

console.log(`SEED ${SEED} — ${TURNS} rounds, ${rolls.length} rolls, ` +
            `${exposure.length} exposure events\n`);

console.log('THE DICE');
console.log(`  ${stats.totalRolls} rolls, ${stats.sevenCount} sevens ` +
            `(${stats.sevenPct.toFixed(1)}%, expected ${stats.sevenExpected})`);
const dist = {};
for (const r of rolls) dist[r.value] = (dist[r.value] ?? 0) + 1;
console.log('  ' + Object.keys(dist).sort((a, b) => a - b)
  .map(k => `${k}:${dist[k]}`).join('  '));
console.log(`  small sample: ${stats.isSmallSample}   exposure data: ${stats.hasExposureData}`);

console.log('\nPER PLAYER');
for (const p of stats.playerStats) {
  console.log(`  ${p.displayName.padEnd(6)} ` +
    `actual ${p.totalActualProduction.toFixed(1).padStart(6)}  ` +
    `expected ${p.totalExpectedProduction.toFixed(1).padStart(6)}  ` +
    `luck ${(p.productionLuck >= 0 ? '+' : '') + p.productionLuck.toFixed(1)}` +
    ` (${(p.productionLuckPct >= 0 ? '+' : '') + p.productionLuckPct.toFixed(0)}%)  ` +
    `pct ${p.productionLuckPercentile === undefined ? " -- " : String(Math.round(p.productionLuckPercentile)).padStart(3)}  ` +
    `place ${p.placementStrength.toFixed(2)}  div ${p.numberDiversity}  ` +
    `cities ${p.finalCityCount}  robbed ${p.robberLostProduction.toFixed(1)}`);
}

console.log('\nTHE VERDICT');
if (!stats.findings) {
  console.log('  (no findings)');
} else {
  const f = stats.findings;
  console.log(`  headline: ${f.headline}`);
  console.log(`  sevens: ${f.sevenFrequency}   roll luck: ${f.rollLuck}   ` +
              `outcome: ${f.finalOutcome}`);
  console.log('  per player:');
  for (const p of PLAYERS) {
    console.log(`    ${p.displayName.padEnd(6)} exposure ${String(f.exposureLuck[p.id]).padEnd(14)}` +
                ` placement ${f.placementRating[p.id]}`);
  }
  console.log('  details:');
  for (const d of f.details) console.log(`    - ${d}`);
}

// ── Sanity checks a player would notice before any test would ────────────────
console.log('\nSANITY');
const problems = [];
const numeric = (label, v) => {
  if (!Number.isFinite(v)) problems.push(`${label} is ${v}`);
};
for (const p of stats.playerStats) {
  numeric(`${p.displayName} actual`, p.totalActualProduction);
  numeric(`${p.displayName} expected`, p.totalExpectedProduction);
  numeric(`${p.displayName} luckPct`, p.productionLuckPct);
  numeric(`${p.displayName} placement`, p.placementStrength);
  if (p.productionLuckPercentile !== undefined) numeric(`${p.displayName} percentile`, p.productionLuckPercentile);
  if (p.totalExpectedProduction === 0) problems.push(`${p.displayName} expected 0 production`);
}
if (stats.findings) {
  const mentioned = new Set();
  for (const d of stats.findings.details) {
    for (const p of PLAYERS) if (d.includes(p.displayName)) mentioned.add(p.displayName);
  }
  const missing = PLAYERS.filter(p => !mentioned.has(p.displayName)).map(p => p.displayName);
  if (missing.length) {
    problems.push(`details mention nobody for: ${missing.join(', ')} ` +
                  `(stated goal: every player gets something interesting)`);
  }
  if (!stats.findings.headline) problems.push('headline is empty');
}
console.log(problems.length === 0 ? '  no problems found'
  : problems.map(p => '  ! ' + p).join('\n'));

// ── What the data supports but nobody is told ────────────────────────────────
//
// The verdict `details` are the same boilerplate in every game and name no
// player. The numbers behind them are specific and per-player. This prints the
// facts that are already computed and currently go unsaid, so the gap between
// "what we know" and "what a player reads" is visible rather than argued.
console.log('\nFACTS ALREADY IN THE DATA, CURRENTLY UNSAID');
const ps = stats.playerStats;
const say = [];
const byPct = [...ps].filter(p => p.productionLuckPercentile !== undefined)
  .sort((a, b) => a.productionLuckPercentile - b.productionLuckPercentile);
if (byPct.length) {
  const worst = byPct[0], best = byPct[byPct.length - 1];
  if (best.productionLuckPercentile >= 75)
    say.push(`${best.displayName}: luckier than ${Math.round(best.productionLuckPercentile)}% of fair games with the same board`);
  if (worst.productionLuckPercentile <= 25)
    say.push(`${worst.displayName}: unluckier than ${100 - Math.round(worst.productionLuckPercentile)}% of fair games — genuinely robbed by the dice`);
}
const mostRobbed = [...ps].sort((a, b) => b.robberLostProduction - a.robberLostProduction)[0];
if (mostRobbed?.robberLostProduction > 0)
  say.push(`${mostRobbed.displayName}: lost ${mostRobbed.robberLostProduction.toFixed(0)} production to the robber, most at the table`);
const bestPlace = [...ps].sort((a, b) => b.placementStrength - a.placementStrength)[0];
say.push(`${bestPlace.displayName}: strongest opening placement (${bestPlace.placementStrength.toFixed(2)} pips-weighted)`);
const widest = [...ps].sort((a, b) => b.numberDiversity - a.numberDiversity)[0];
say.push(`${widest.displayName}: widest spread, ${widest.numberDiversity} different numbers`);
const cities = [...ps].sort((a, b) => b.finalCityCount - a.finalCityCount)[0];
if (cities.finalCityCount > 0)
  say.push(`${cities.displayName}: finished with ${cities.finalCityCount} cit${cities.finalCityCount === 1 ? 'y' : 'ies'}`);
const gap = ps.reduce((m, p) => Math.max(m, Math.abs(p.productionLuckPct)), 0);
say.push(`widest luck swing at the table: ${gap.toFixed(0)}%`);
const hot = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
say.push(`hottest number: ${hot[0]} came up ${hot[1]} times in ${stats.totalRolls} rolls`);
for (const s of say) console.log('  * ' + s);
const named = new Set(say.flatMap(s => PLAYERS.filter(p => s.includes(p.displayName)).map(p => p.displayName)));
console.log(`  -> ${named.size}/${PLAYERS.length} players could be named from data already computed`);

// ── The accolades ────────────────────────────────────────────────────────────
import { assignAccolades, profileRolls, ACCOLADE_COUNT, ACCOLADE_CATALOGUE }
  from '../artifacts/dice-tracker/dist-game/catanAccolades.js';

const profiles = profileRolls(PLAYERS, rolls, exposure);
console.log(`
ACCOLADES  (${ACCOLADE_COUNT} possible, from ${ACCOLADE_CATALOGUE.length} axes)`);
for (const a of assignAccolades(stats.playerStats, profiles)) {
  console.log(`  ${a.displayName.padEnd(6)} ${a.title.padEnd(24)} `
    + `${a.rank}/${a.outOf} ${a.kind}  [${a.strength.toFixed(2)}]`);
  console.log(`  ${''.padEnd(6)} ${a.detail}`);
}

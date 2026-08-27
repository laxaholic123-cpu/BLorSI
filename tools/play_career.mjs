/**
 * Play a whole SEASON of Catan through the real services.
 *
 * `careerStats.ts` aggregates across sessions — lifetime per-number luck,
 * head-to-head records between recurring players, minimum-session gates before
 * anything is surfaced. None of it has ever run against realistic multi-session
 * data. The single-session path found a real correctness bug the first time it
 * was driven properly, and this surface is larger.
 *
 * Deliberately awkward on purpose. Career identity is resolved by lowercased
 * display name, which is a decision with sharp edges: a player who types their
 * name differently one night, a guest who shares a name with a regular, a
 * session abandoned half way. Those are the cases a real group produces within
 * a month, so they are in here from the start rather than as an afterthought.
 *
 *   node tools/play_career.mjs [seasons]
 */
import { computeCareerStats, CAREER_MIN_SESSIONS, HEAD_TO_HEAD_MIN_SESSIONS }
  from '../artifacts/dice-tracker/dist-game/careerStats.js';
import { computeCatanGameStats } from '../artifacts/dice-tracker/dist-game/catanStats.js';
import { generateBoard } from '../artifacts/dice-tracker/dist-game/boardGenerator.js';
import { getAllIntersections } from '../artifacts/dice-tracker/dist-game/catanBoard.js';

const SESSIONS = Number(process.argv[2] ?? 6);

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The regulars, plus the awkward cases a real group produces.
 *
 * "alex" and "Alex " are the SAME person typing carelessly — career identity
 * lowercases but does it trim? And "Sam" appears in two sessions as two
 * different people, which no name-keyed system can tell apart.
 */
const ROSTERS = [
  ['Alex', 'Bo', 'Cass', 'Dre'],
  ['alex', 'Bo', 'Cass'],
  ['Alex ', 'Bo', 'Dre', 'Sam'],
  ['Alex', 'Cass', 'Sam'],
  ['Bo', 'Cass', 'Dre'],
  ['Alex', 'Bo', 'Cass', 'Dre'],
  ['Alex', 'Bo'],
  ['Cass', 'Dre'],
];

const intersections = getAllIntersections().filter(i => i.hexIndices.length >= 2);
const sessions = [];
const rollsBySession = {};
const exposuresBySession = {};
const perSessionStats = [];

for (let s = 0; s < SESSIONS; s++) {
  const rng = makeRng(1000 + s);
  const board = generateBoard({ seed: 1000 + s });
  const hexes = board.hexes;
  const names = ROSTERS[s % ROSTERS.length];
  const players = names.map((displayName, i) => ({
    id: `s${s}p${i}`, displayName,
    color: ['#F5A623', '#4A90D9', '#7ED321', '#D0021B', '#9013FE'][i] ?? '#888',
    seatNumber: i + 1,
    createdAt: new Date(2026, 6, 1 + s).toISOString(),
  }));

  // Every fourth night somebody packs up early.
  const abandoned = s % 4 === 3;
  const session = {
    id: `sess-${s}`, gameType: 'catan', diceMode: '2D6',
    minimumRoll: 2, maximumRoll: 12, players, currentPlayerIndex: 0,
    autoAdvancePlayer: true,
    startedAt: new Date(2026, 6, 1 + s, 19).toISOString(),
    endedAt: abandoned ? undefined : new Date(2026, 6, 1 + s, 21).toISOString(),
    status: abandoned ? 'active' : 'completed',
    winnerPlayerId: abandoned ? undefined : players[s % players.length].id,
    settings: { recordIndividualDice: false, catanTrackExposure: true, catanTrackDevCards: false },
    schemaVersion: 1,
  };

  const exposure = [];
  const taken = new Set();
  let evId = 0;
  for (const p of players) {
    for (let k = 0; k < 2; k++) {
      let pick = null;
      for (let attempt = 0; attempt < 200; attempt++) {
        const cand = intersections[Math.floor(rng() * intersections.length)];
        if (taken.has(cand.id)) continue;
        const nums = cand.hexIndices.map(i => hexes[i]?.number).filter(n => n != null);
        if (!nums.length) continue;
        taken.add(cand.id);
        pick = { cand, nums };
        break;
      }
      if (!pick) continue;
      exposure.push({
        id: `${session.id}-e${evId++}`, sessionId: session.id, playerId: p.id,
        eventType: 'initialSettlement', turnNumber: 0, timestamp: session.startedAt,
        hexIdentifiers: [pick.cand.id], affectedNumbers: pick.nums,
        productionWeight: 1, robberBlocked: false,
      });
    }
  }

  const rolls = [];
  const turns = abandoned ? 6 : 20;
  let seq = 0;
  for (let turn = 1; turn <= turns; turn++) {
    for (const p of players) {
      rolls.push({
        id: `${session.id}-r${seq}`, sessionId: session.id, playerId: p.id,
        value: (1 + Math.floor(rng() * 6)) + (1 + Math.floor(rng() * 6)),
        turnNumber: turn, sequenceNumber: seq++,
        timestamp: session.startedAt, source: 'touchscreen',
      });
    }
  }

  sessions.push(session);
  rollsBySession[session.id] = rolls;
  exposuresBySession[session.id] = exposure;
  perSessionStats.push(computeCatanGameStats(session, rolls, exposure, {}));
}

const career = computeCareerStats(sessions, rollsBySession, exposuresBySession);

console.log(`${SESSIONS} sessions played\n`);
console.log('SUMMARY');
for (const [k, v] of Object.entries(career.summary)) {
  console.log(`  ${k.padEnd(22)} ${v}`);
}

console.log('\nPER-NUMBER LIFETIME LUCK');
if (!career.numberStats) {
  console.log('  (null — no board sessions with exposure data)');
} else {
  for (const n of career.numberStats.slice(0, 4)) {
    console.log(`  ${String(n.number).padStart(2)}  expected ${n.totalExpected.toFixed(0).padStart(5)}`
      + `  actual ${n.totalActual.toFixed(0).padStart(5)}  luck ${n.luckPct >= 0 ? '+' : ''}`
      + `${n.luckPct.toFixed(0)}%  over ${n.sessionCount} sessions`);
  }
  console.log(`  ... ${career.numberStats.length} numbers total`);
}

console.log('\nHEAD TO HEAD');
if (career.headToHead.length === 0) {
  console.log(`  (none — needs ${HEAD_TO_HEAD_MIN_SESSIONS} shared sessions)`);
}
for (const h of career.headToHead) {
  console.log(`  ${h.nameA} vs ${h.nameB}: ${h.sharedSessions} shared, `
    + `${h.winsA}-${h.winsB}-${h.ties}, avg luck diff `
    + `${h.avgLuckDiffA >= 0 ? '+' : ''}${h.avgLuckDiffA.toFixed(1)}%`);
}

// ── The awkward cases, checked rather than assumed ───────────────────────────
console.log('\nSANITY');
const problems = [];
const names = new Set(sessions.flatMap(s => s.players.map(p => p.displayName)));
console.log(`  distinct display names used: ${[...names].map(n => JSON.stringify(n)).join(', ')}`);

const h2hNames = new Set(career.headToHead.flatMap(h => [h.nameA, h.nameB]));
// "Alex", "alex" and "Alex " are one person typing carelessly. If career
// identity only lowercases without trimming, the third becomes a stranger.
const alexLike = [...h2hNames].filter(n => n.trim().toLowerCase() === 'alex');
if (alexLike.length > 1) {
  problems.push(`"Alex" split into ${alexLike.length} career identities: `
    + `${alexLike.map(n => JSON.stringify(n)).join(', ')} — whitespace is not trimmed`);
}

for (const [k, v] of Object.entries(career.summary)) {
  if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`summary.${k} is ${v}`);
}
for (const n of career.numberStats ?? []) {
  if (!Number.isFinite(n.luckPct)) problems.push(`number ${n.number} luckPct is ${n.luckPct}`);
  if (n.sessionCount > sessions.length) {
    problems.push(`number ${n.number} claims ${n.sessionCount} sessions of ${sessions.length}`);
  }
}
for (const h of career.headToHead) {
  if (h.winsA + h.winsB + h.ties !== h.sharedSessions) {
    problems.push(`${h.nameA} vs ${h.nameB}: ${h.winsA}+${h.winsB}+${h.ties} `
      + `does not equal ${h.sharedSessions} shared sessions`);
  }
  if (h.sharedSessions < HEAD_TO_HEAD_MIN_SESSIONS) {
    problems.push(`${h.nameA} vs ${h.nameB} surfaced with only ${h.sharedSessions} shared`);
  }
  if (!Number.isFinite(h.avgLuckDiffA)) {
    problems.push(`${h.nameA} vs ${h.nameB} avgLuckDiff is ${h.avgLuckDiffA}`);
  }
}

const totalRolls = Object.values(rollsBySession).reduce((s, r) => s + r.length, 0);
if (career.summary.totalRolls !== totalRolls) {
  problems.push(`summary.totalRolls ${career.summary.totalRolls} != actual ${totalRolls}`);
}

console.log(problems.length === 0 ? '  no problems found'
  : problems.map(p => '  ! ' + p).join('\n'));

/**
 * Does the app really get slower as a game goes on, and by how much?
 *
 * Reported from a device as "it seems like the app slows down a bit as the
 * number of rolls gets higher, feels weird". That is a claim with a number
 * behind it, so this measures the number instead of guessing at the cause.
 *
 * Times the work the active game screen redoes on EVERY roll: the per-player
 * production stats, which is what the live leaderboard is built from. If the
 * cost per roll is flat, the feeling is something else. If it climbs, the
 * shape of the climb says which loop is responsible.
 *
 *   node tools/perf_probe.mjs
 */
import { computePlayerProductionStats } from
  '../artifacts/dice-tracker/dist-game/catanStats.js';
import { generateBoard } from '../artifacts/dice-tracker/dist-game/boardGenerator.js';
import { getAllIntersections } from '../artifacts/dice-tracker/dist-game/catanBoard.js';
import { robberMoveEvents } from '../artifacts/dice-tracker/dist-game/catanRobber.js';
import { boardStateAtTurn } from '../artifacts/dice-tracker/dist-game/catanBoardState.js';

const PLAYERS = ['Alex', 'Bo', 'Cass', 'Dre'].map((displayName, i) => ({
  id: `p${i}`, displayName, color: '#fff',
}));

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A realistic log: openings, rolls, a robber move on every 7. */
function buildLog(rounds, rng) {
  const board = generateBoard({ seed: 99 });
  const corners = getAllIntersections();
  const exposure = [];
  const used = new Set();

  for (let round = 0; round < 2; round++) {
    for (const p of PLAYERS) {
      let c;
      do { c = corners[Math.floor(rng() * corners.length)]; } while (used.has(c.id));
      used.add(c.id);
      exposure.push({
        id: `e${exposure.length}`, sessionId: 's', playerId: p.id,
        eventType: 'initialSettlement', turnNumber: 0,
        timestamp: new Date().toISOString(),
        affectedNumbers: c.hexIndices
          .map(h => board.hexes[h]?.number)
          .filter(n => typeof n === 'number' && n !== 7),
        hexIdentifiers: [c.id], productionWeight: 1, robberBlocked: false,
      });
    }
  }

  const rolls = [];
  for (let round = 1; round <= rounds; round++) {
    for (const p of PLAYERS) {
      const v = 1 + Math.floor(rng() * 6) + 1 + Math.floor(rng() * 6);
      rolls.push({
        id: `r${rolls.length}`, sessionId: 's', playerId: p.id, value: v,
        turnNumber: round, sequenceNumber: rolls.length + 1,
        timestamp: new Date().toISOString(), source: 'touchscreen',
      });
      if (v === 7) {
        const hexIndex = Math.floor(rng() * 19);
        exposure.push(...robberMoveEvents({
          sessionId: 's', hexIndex,
          hexNumber: board.hexes[hexIndex]?.number ?? null,
          turnNumber: round,
          snapshot: boardStateAtTurn(exposure, PLAYERS.map(x => x.id), round),
          events: exposure,
        }));
      }
    }
  }
  return { rolls, exposure };
}

console.log('rolls   total ms   per-roll ms   vs 20 rolls');
let baseline = null;

for (const rounds of [5, 10, 20, 30, 40, 60]) {
  const rng = makeRng(7);
  const { rolls, exposure } = buildLog(rounds, rng);

  // What the active screen recomputes whenever a roll lands.
  const t0 = performance.now();
  const REPS = 5;
  for (let r = 0; r < REPS; r++) {
    for (const p of PLAYERS) computePlayerProductionStats(p, rolls, exposure);
  }
  const ms = (performance.now() - t0) / REPS;

  const perRoll = ms / rolls.length;
  if (rolls.length >= 80 && baseline === null) baseline = ms;
  const rel = baseline ? (ms / baseline).toFixed(1) + 'x' : '—';
  console.log(
    String(rolls.length).padStart(5),
    ms.toFixed(1).padStart(9),
    perRoll.toFixed(3).padStart(13),
    rel.padStart(13),
  );
}

console.log('\nA FLAT per-roll column means the cost is linear and the feeling is');
console.log('something else. A CLIMBING one means each roll re-does work for every');
console.log('earlier roll, which is quadratic and gets worse exactly as reported.');

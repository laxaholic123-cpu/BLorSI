/**
 * Is every roll actually landing on the right players?
 *
 * "Are we confident all the rolls and corresponding resource exposures are
 * being captured?" is not a question to answer by reading the code — the code
 * is what would be wrong. So this recomputes the whole production ledger from
 * the RAW EVENT LOG, independently of `computePlayerProductionStats`, and
 * compares. Two implementations that disagree mean one of them is wrong; two
 * that agree at least rule out a whole class of bookkeeping error.
 *
 * The independent pass deliberately does NOT reuse getBuildingStatesAtTurn or
 * getActiveRobberBlockedNumbers. It walks the events itself. Sharing the
 * helpers would make the comparison circular, which is how a check like this
 * quietly proves nothing.
 *
 *   node tools/capture_audit.mjs [seed] [games]
 */
import { computePlayerProductionStats } from
  '../artifacts/dice-tracker/dist-game/catanStats.js';
import { generateBoard } from '../artifacts/dice-tracker/dist-game/boardGenerator.js';
import { getAllIntersections } from '../artifacts/dice-tracker/dist-game/catanBoard.js';
import { robberMoveEvents } from '../artifacts/dice-tracker/dist-game/catanRobber.js';
import { boardStateAtTurn } from '../artifacts/dice-tracker/dist-game/catanBoardState.js';
import { getBuildingStatesAtTurn, getActiveRobberBlockDetails, grossWeightForNumber, netWeightForNumber }
  from '../artifacts/dice-tracker/dist-game/catanStats.js';

const SEED = Number(process.argv[2] ?? 4242);
const GAMES = Number(process.argv[3] ?? 25);

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

const PLAYERS = ['Alex', 'Bo', 'Cass', 'Dre'].map((displayName, i) => ({
  id: `p${i}`, displayName, color: '#fff',
}));

/** One synthetic session: a board, openings, some building, rolls, robbers. */
function playSession(rng) {
  const board = generateBoard({ seed: Math.floor(rng() * 1e9) });
  const hexes = board.hexes;
  const corners = getAllIntersections();
  const numbersAt = id => {
    const c = corners.find(x => x.id === id);
    return c.hexIndices
      .map(h => hexes[h]?.number)
      .filter(n => typeof n === 'number' && n !== 7);
  };

  const exposure = [];
  const used = new Set();
  let seq = 0;
  const nextId = () => `e${seq++}`;

  // Opening: two settlements each, on distinct corners.
  for (let round = 0; round < 2; round++) {
    for (const p of PLAYERS) {
      let corner;
      do {
        corner = corners[Math.floor(rng() * corners.length)].id;
      } while (used.has(corner));
      used.add(corner);
      exposure.push({
        id: nextId(), sessionId: 's', playerId: p.id,
        eventType: 'initialSettlement', turnNumber: 0,
        timestamp: new Date().toISOString(),
        affectedNumbers: numbersAt(corner), hexIdentifiers: [corner],
        productionWeight: 1, robberBlocked: false,
      });
    }
  }

  const rolls = [];
  const ROUNDS = 20;
  for (let round = 1; round <= ROUNDS; round++) {
    for (const p of PLAYERS) {
      const v = 1 + Math.floor(rng() * 6) + 1 + Math.floor(rng() * 6);
      rolls.push({
        id: `r${rolls.length}`, sessionId: 's', playerId: p.id, value: v,
        turnNumber: round, sequenceNumber: rolls.length + 1,
        timestamp: new Date().toISOString(), source: 'touchscreen',
      });

      // A seven moves the robber to a random tile — through the real service,
      // so the ends-then-starts behaviour is what the app would write.
      if (v === 7) {
        const hexIndex = Math.floor(rng() * 19);
        const snapshot = boardStateAtTurn(exposure, PLAYERS.map(x => x.id), round);
        exposure.push(...robberMoveEvents({
          sessionId: 's', hexIndex,
          hexNumber: hexes[hexIndex]?.number ?? null,
          turnNumber: round, snapshot, events: exposure,
        }));
      }

      // Occasionally build or upgrade.
      if (rng() < 0.12) {
        let corner;
        let tries = 0;
        do { corner = corners[Math.floor(rng() * corners.length)].id; tries++; }
        while (used.has(corner) && tries < 20);
        if (!used.has(corner)) {
          used.add(corner);
          exposure.push({
            id: nextId(), sessionId: 's', playerId: p.id,
            eventType: 'settlementBuilt', turnNumber: round,
            timestamp: new Date().toISOString(),
            affectedNumbers: numbersAt(corner), hexIdentifiers: [corner],
            productionWeight: 1, robberBlocked: false,
          });
        }
      }
      if (rng() < 0.06) {
        const mine = exposure.filter(
          e => e.playerId === p.id && e.eventType === 'initialSettlement');
        const target = mine[Math.floor(rng() * mine.length)];
        if (target) {
          exposure.push({
            id: nextId(), sessionId: 's', playerId: p.id,
            eventType: 'cityUpgrade', turnNumber: round,
            timestamp: new Date().toISOString(),
            affectedNumbers: target.affectedNumbers,
            hexIdentifiers: target.hexIdentifiers,
            productionWeight: 2, robberBlocked: false,
          });
        }
      }
    }
  }
  return { rolls, exposure };
}

/**
 * The ledger, recomputed from scratch.
 *
 * Walks the log turn by turn keeping its own picture of what each player holds
 * and what the robber is blocking, then adds up what every roll should pay.
 */
function independentLedger(playerId, rolls, exposure, corners) {
  const mine = exposure.filter(e => e.playerId === playerId);
  let actual = 0;
  let robbed = 0;

  for (const roll of rolls) {
    const T = roll.turnNumber;

    // Buildings: latest event per location, at or before this turn.
    const byLocation = new Map();
    for (const e of mine) {
      if (e.turnNumber > T) continue;
      if (!['initialSettlement', 'settlementBuilt', 'cityUpgrade',
            'buildingRemoved', 'manualCorrection'].includes(e.eventType)) continue;
      const loc = e.hexIdentifiers?.[0];
      if (!loc) continue;
      byLocation.set(loc, e);
    }

    // Robber: started minus ended, by block id, keeping the hex.
    const live = new Map();
    for (const e of mine) {
      if (e.turnNumber > T) continue;
      const id = e.hexIdentifiers?.[0];
      if (!id) continue;
      if (e.eventType === 'robberBlockStarted') {
        live.set(id, {
          numbers: e.affectedNumbers,
          hexIndex: typeof e.robberHexIndex === 'number' ? e.robberHexIndex : null,
        });
      } else if (e.eventType === 'robberBlockEnded') live.delete(id);
    }

    let gross = 0;
    const active = [];
    for (const e of byLocation.values()) {
      if (e.eventType === 'buildingRemoved') continue;
      if (e.productionWeight <= 0) continue;
      active.push(e);
      for (const n of e.affectedNumbers) {
        if (n === roll.value) gross += e.productionWeight;
      }
    }

    /*
     * The robber sits on ONE TILE, so it removes one tile's worth — not every
     * building the player owns on that number. Getting this wrong was my first
     * attempt at this audit: I zeroed all production on a blocked number and
     * "found" 32 mismatches that were entirely my own error.
     *
     * With the hex recorded the charge is exact: the buildings standing on
     * that tile. Without it, the shipped fallback is the largest single share.
     */
    let blockedWeight = 0;
    for (const b of live.values()) {
      if (!b.numbers.includes(roll.value)) continue;
      let thisBlock = 0;
      if (b.hexIndex !== null) {
        const onHex = new Set(
          corners.filter(c => c.hexIndices.includes(b.hexIndex)).map(c => c.id));
        for (const e of active) {
          if (!e.affectedNumbers.includes(roll.value)) continue;
          if (!onHex.has(e.hexIdentifiers?.[0])) continue;
          thisBlock += e.productionWeight;
        }
      } else {
        for (const e of active) {
          if (!e.affectedNumbers.includes(roll.value)) continue;
          if (e.productionWeight > thisBlock) thisBlock = e.productionWeight;
        }
      }
      if (thisBlock > blockedWeight) blockedWeight = thisBlock;
    }

    const net = Math.max(0, gross - blockedWeight);
    actual += net;
    robbed += gross - net;
  }
  return { actual, robbed };
}

let mismatches = 0;
let checked = 0;
let totalProduction = 0;
let totalRobbed = 0;
const rng = makeRng(SEED);

for (let g = 0; g < GAMES; g++) {
  const { rolls, exposure } = playSession(rng);
  for (const p of PLAYERS) {
    const shipped = computePlayerProductionStats(p, rolls, exposure);
    const mine = independentLedger(p.id, rolls, exposure, getAllIntersections());
    checked++;
    totalProduction += mine.actual;
    totalRobbed += mine.robbed;
    const dActual = Math.abs(shipped.totalActualProduction - mine.actual);
    const dRobbed = Math.abs((shipped.robberLostProduction ?? 0) - mine.robbed);
    if (dActual > 1e-9 || dRobbed > 1e-9) {
      mismatches++;
      if (mismatches === 1 && process.env.TRACE) {
        const corners = getAllIntersections();
        const mineEv = exposure.filter(e => e.playerId === p.id);
        for (const roll of rolls) {
          const T = roll.turnNumber;
          const b = getBuildingStatesAtTurn(p.id, T, mineEv);
          const det = getActiveRobberBlockDetails(p.id, T, mineEv);
          const g = grossWeightForNumber(b, roll.value);
          const n = netWeightForNumber(b, roll.value, det.flatMap(d => d.numbers), det);
          if (g !== n) {
            console.log(`   turn ${T} roll ${roll.value}: gross=${g} net=${n} blocks=${JSON.stringify(det)}`);
            console.log(`     buildings on ${roll.value}:`, b.filter(x => x.affectedNumbers.includes(roll.value))
              .map(x => `${x.locationId} w${x.productionWeight} [${x.affectedNumbers}]`).join(' | '));
          }
        }
      }
      if (mismatches <= 5) {
        console.log(
          `  MISMATCH game ${g} ${p.displayName}: ` +
          `actual shipped=${shipped.totalActualProduction} mine=${mine.actual} | ` +
          `robbed shipped=${shipped.robberLostProduction} mine=${mine.robbed}`);
      }
    }
  }
}

console.log(`\nCAPTURE AUDIT — seed ${SEED}, ${GAMES} games, ${checked} player-ledgers`);
console.log(`  production accounted for : ${totalProduction}`);
console.log(`  production lost to robber: ${totalRobbed}`);
console.log(`  ledger mismatches        : ${mismatches}`);
console.log(mismatches === 0
  ? '  PASS — the shipped stats and an independent recount agree exactly.'
  : '  FAIL — see above.');

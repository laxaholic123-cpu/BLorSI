/**
 * The robber as a board position.
 *
 * The two tests that matter are the two bugs: a move must END what came
 * before (blocks used to accumulate forever, under-counting production in the
 * one direction that flatters a player's bad luck), and blocking must follow
 * the TILE rather than the number (two hexes can share a number, and the old
 * model punished a player standing on the wrong one).
 */

import {
  activeRobberBlocks,
  currentRobberHex,
  isBoardHex,
  playersOnHex,
  robberMoveEvents,
} from '@/services/catanRobber';
import { boardStateAtTurn } from '@/services/catanBoardState';
import { getAllIntersections, HEX_COUNT } from '@/services/catanBoard';
import { getActiveRobberBlockedNumbers } from '@/services/catanStats';
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent } from '@/types/models';

function settlement(playerId: string, cornerId: string, numbers: number[]) {
  return {
    id: generateId(),
    sessionId: 's1',
    playerId,
    eventType: 'initialSettlement',
    turnNumber: 0,
    timestamp: new Date().toISOString(),
    affectedNumbers: numbers,
    hexIdentifiers: [cornerId],
    productionWeight: 1,
    robberBlocked: false,
  } as CatanPlayerExposureEvent;
}

/** A corner touching `hexIndex`, and one touching nothing near it. */
const cornerOn = (hexIndex: number) =>
  getAllIntersections().find(i => i.hexIndices.includes(hexIndex))!.id;
const cornerNotOn = (hexIndex: number) =>
  getAllIntersections().find(i => !i.hexIndices.includes(hexIndex))!.id;

describe('playersOnHex', () => {
  it('finds whoever holds a corner of that tile', () => {
    const snap = boardStateAtTurn([settlement('p1', cornerOn(9), [6])], ['p1']);
    expect(playersOnHex(9, snap)).toEqual(['p1']);
  });

  it('ignores players who are not on it', () => {
    const snap = boardStateAtTurn([settlement('p1', cornerNotOn(9), [6])], ['p1']);
    expect(playersOnHex(9, snap)).toEqual([]);
  });

  it('lists every player on the tile, once each', () => {
    const corners = getAllIntersections().filter(i => i.hexIndices.includes(9));
    const snap = boardStateAtTurn(
      [
        settlement('p1', corners[0]!.id, [6]),
        settlement('p2', corners[2]!.id, [6]),
      ],
      ['p1', 'p2'],
    );
    expect(playersOnHex(9, snap).sort()).toEqual(['p1', 'p2']);
  });
});

describe('a robber move ends what came before', () => {
  const snap = boardStateAtTurn([settlement('p1', cornerOn(9), [6])], ['p1']);

  it('produces a start when it lands on somebody', () => {
    const evs = robberMoveEvents({
      sessionId: 's1', hexIndex: 9, hexNumber: 6, turnNumber: 3, snapshot: snap, events: [],
    });
    expect(evs.filter(e => e.eventType === 'robberBlockStarted')).toHaveLength(1);
    expect(evs[0]!.playerId).toBe('p1');
    expect(evs[0]!.robberHexIndex).toBe(9);
    expect(evs[0]!.affectedNumbers).toEqual([6]);
  });

  it('ENDS the previous block when it moves on', () => {
    const first = robberMoveEvents({
      sessionId: 's1', hexIndex: 9, hexNumber: 6, turnNumber: 3, snapshot: snap, events: [],
    });
    const second = robberMoveEvents({
      sessionId: 's1', hexIndex: 4, hexNumber: 8, turnNumber: 5,
      snapshot: snap, events: first,
    });
    expect(second.filter(e => e.eventType === 'robberBlockEnded')).toHaveLength(1);
    expect(activeRobberBlocks([...first, ...second])).toHaveLength(
      // whatever the new hex blocks, and nothing left over from the old one
      playersOnHex(4, snap).length,
    );
  });

  it('never lets blocks accumulate across many sevens — the old bug', () => {
    let all: CatanPlayerExposureEvent[] = [];
    for (let turn = 1; turn <= 6; turn++) {
      all = [...all, ...robberMoveEvents({
        sessionId: 's1', hexIndex: 9, hexNumber: 6, turnNumber: turn,
        snapshot: snap, events: all,
      })];
    }
    // One robber, one tile, one block — no matter how many times it moved.
    expect(activeRobberBlocks(all)).toHaveLength(1);
    expect(getActiveRobberBlockedNumbers('p1', 99, all)).toEqual([6]);
  });

  it('blocks nothing on the desert but still lifts the old block', () => {
    const first = robberMoveEvents({
      sessionId: 's1', hexIndex: 9, hexNumber: 6, turnNumber: 3, snapshot: snap, events: [],
    });
    const toDesert = robberMoveEvents({
      sessionId: 's1', hexIndex: 4, hexNumber: null, turnNumber: 4,
      snapshot: snap, events: first,
    });
    expect(toDesert.every(e => e.eventType === 'robberBlockEnded')).toBe(true);
    expect(activeRobberBlocks([...first, ...toDesert])).toHaveLength(0);
    expect(getActiveRobberBlockedNumbers('p1', 99, [...first, ...toDesert])).toEqual([]);
  });

  it('blocks nobody when it lands on an empty tile, and still lifts', () => {
    const first = robberMoveEvents({
      sessionId: 's1', hexIndex: 9, hexNumber: 6, turnNumber: 3, snapshot: snap, events: [],
    });
    const emptyHex = [...Array(HEX_COUNT).keys()].find(h => playersOnHex(h, snap).length === 0)!;
    const moved = robberMoveEvents({
      sessionId: 's1', hexIndex: emptyHex, hexNumber: 10, turnNumber: 4,
      snapshot: snap, events: first,
    });
    expect(moved.filter(e => e.eventType === 'robberBlockStarted')).toHaveLength(0);
    expect(activeRobberBlocks([...first, ...moved])).toHaveLength(0);
  });
});

describe('the tile matters, not the number', () => {
  it('spares a player on the OTHER hex carrying the same number', () => {
    // Two different hexes, both printed 5. The robber sits on one of them.
    const hexA = 9;
    const hexB = [...Array(HEX_COUNT).keys()].find(
      h => h !== hexA && !getAllIntersections().some(
        i => i.hexIndices.includes(h) && i.hexIndices.includes(hexA)),
    )!;
    const snap = boardStateAtTurn(
      [
        settlement('victim', cornerOn(hexA), [5]),
        settlement('spared', cornerOn(hexB), [5]),
      ],
      ['victim', 'spared'],
    );
    const evs = robberMoveEvents({
      sessionId: 's1', hexIndex: hexA, hexNumber: 5, turnNumber: 2, snapshot: snap, events: [],
    });
    const blocked = evs
      .filter(e => e.eventType === 'robberBlockStarted')
      .map(e => e.playerId);
    expect(blocked).toContain('victim');
    expect(blocked).not.toContain('spared');
  });
});

describe('currentRobberHex', () => {
  const snap = boardStateAtTurn([settlement('p1', cornerOn(9), [6])], ['p1']);

  it('is null before the robber has been placed', () => {
    expect(currentRobberHex([])).toBeNull();
  });

  it('reports the tile it last moved to', () => {
    const first = robberMoveEvents({
      sessionId: 's1', hexIndex: 9, hexNumber: 6, turnNumber: 3, snapshot: snap, events: [],
    });
    expect(currentRobberHex(first)).toBe(9);
  });

  it('ignores legacy blocks that name no hex', () => {
    const legacy: CatanPlayerExposureEvent = {
      id: 'l1', sessionId: 's1', playerId: 'p1', eventType: 'robberBlockStarted',
      turnNumber: 1, timestamp: new Date().toISOString(), affectedNumbers: [8],
      hexIdentifiers: ['rblock_legacy'], productionWeight: 0, robberBlocked: true,
    };
    expect(currentRobberHex([legacy])).toBeNull();
    // ...but the block itself is still honoured, because it is what was recorded.
    expect(getActiveRobberBlockedNumbers('p1', 99, [legacy])).toEqual([8]);
  });
});

describe('isBoardHex', () => {
  it('accepts every real hex and nothing else', () => {
    for (let i = 0; i < HEX_COUNT; i++) expect(isBoardHex(i)).toBe(true);
    expect(isBoardHex(-1)).toBe(false);
    expect(isBoardHex(HEX_COUNT)).toBe(false);
    expect(isBoardHex(1.5)).toBe(false);
  });
});

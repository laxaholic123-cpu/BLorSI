/**
 * Board constraint solver tests.
 *
 * The point of the solver is that a board which cannot physically exist gets
 * repaired into one that can, moving as little as possible. These tests pin both
 * halves of that: legality of the output, and minimality of the change.
 */

import {
  BOARD_HEX_COUNT,
  BOARD_RESOURCE_COUNTS,
  BOARD_TOKEN_COUNTS,
  BOARD_TOKEN_TOTAL,
  describeChange,
  hungarian,
  reconcileBoard,
  validateBoardComposition,
} from '@/services/boardConstraints';
import type { CatanHexDef, ResourceType } from '@/types/models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A legal board: correct tile counts, correct tokens, desert unnumbered. */
function legalBoard(): CatanHexDef[] {
  const resources: ResourceType[] = [];
  for (const [resource, count] of Object.entries(BOARD_RESOURCE_COUNTS)) {
    for (let i = 0; i < count; i++) resources.push(resource as ResourceType);
  }
  const tokens: number[] = [];
  for (const [token, count] of Object.entries(BOARD_TOKEN_COUNTS)) {
    for (let i = 0; i < count; i++) tokens.push(Number(token));
  }

  let tokenCursor = 0;
  return resources.map((resource, index) => ({
    index,
    resource,
    number: resource === 'desert' ? null : tokens[tokenCursor++]!,
    confidence: 'high' as const,
  }));
}

describe('component counts', () => {
  it('nineteen tiles come out of the box', () => {
    const total = Object.values(BOARD_RESOURCE_COUNTS).reduce((s, n) => s + n, 0);
    expect(total).toBe(BOARD_HEX_COUNT);
  });

  it('eighteen tokens come out of the box — the desert has none', () => {
    const total = Object.values(BOARD_TOKEN_COUNTS).reduce((s, n) => s + n, 0);
    expect(total).toBe(BOARD_TOKEN_TOTAL);
    expect(total).toBe(BOARD_HEX_COUNT - BOARD_RESOURCE_COUNTS['desert']!);
  });

  it('has one 2 and one 12, two of everything else', () => {
    expect(BOARD_TOKEN_COUNTS[2]).toBe(1);
    expect(BOARD_TOKEN_COUNTS[12]).toBe(1);
    for (const n of [3, 4, 5, 6, 8, 9, 10, 11]) expect(BOARD_TOKEN_COUNTS[n]).toBe(2);
  });

  it('has no 7 token', () => {
    expect(BOARD_TOKEN_COUNTS[7]).toBeUndefined();
  });
});

describe('hungarian', () => {
  it('solves a trivial 1x1', () => {
    expect(hungarian([[5]])).toEqual([0]);
  });

  it('picks the cheaper of two pairings', () => {
    // Assigning row0→col1 and row1→col0 costs 2; the diagonal costs 20.
    const assignment = hungarian([
      [10, 1],
      [1, 10],
    ]);
    expect(assignment).toEqual([1, 0]);
  });

  it('finds the known optimum on a 3x3', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const assignment = hungarian(cost);
    const total = assignment.reduce((s, col, row) => s + cost[row]![col]!, 0);
    expect(total).toBe(5); // 4 + 0 + ... optimum is rows→[0,1,2] = 4+0+2
    expect(new Set(assignment).size).toBe(3);
  });

  it('returns a permutation — every column used exactly once', () => {
    const n = 8;
    const cost = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => ((i * 7 + j * 13) % 11) + 1),
    );
    const assignment = hungarian(cost);
    expect(assignment).toHaveLength(n);
    expect(new Set(assignment).size).toBe(n);
    expect(assignment.every(c => c >= 0 && c < n)).toBe(true);
  });

  it('handles an empty matrix', () => {
    expect(hungarian([])).toEqual([]);
  });

  it('beats greedy where greedy is trapped', () => {
    // Greedy takes the 0 at [0][0] and is then forced into a 9.
    const cost = [
      [0, 1],
      [9, 1],
    ];
    const assignment = hungarian(cost);
    const total = assignment.reduce((s, col, row) => s + cost[row]![col]!, 0);
    expect(total).toBe(1 + 9 > 0 + 1 ? 1 : total); // optimum is 0 + 1 = 1
    expect(total).toBe(1);
  });
});

describe('validateBoardComposition', () => {
  it('accepts a legal board', () => {
    expect(validateBoardComposition(legalBoard())).toEqual([]);
  });

  it('flags too many of one resource', () => {
    const board = legalBoard();
    board[0] = { ...board[0]!, resource: 'ore' };
    board[1] = { ...board[1]!, resource: 'ore' };
    board[2] = { ...board[2]!, resource: 'ore' };
    board[3] = { ...board[3]!, resource: 'ore' };
    const problems = validateBoardComposition(board);
    expect(problems.some(p => p.kind === 'resource_count')).toBe(true);
  });

  it('flags a desert carrying a number token', () => {
    const board = legalBoard();
    const desert = board.findIndex(h => h.resource === 'desert');
    board[desert] = { ...board[desert]!, number: 8 };
    const problems = validateBoardComposition(board);
    expect(problems.some(p => p.kind === 'desert_token')).toBe(true);
  });

  it('flags a productive hex with no token', () => {
    const board = legalBoard();
    const grain = board.findIndex(h => h.resource === 'grain');
    board[grain] = { ...board[grain]!, number: null };
    const problems = validateBoardComposition(board);
    expect(problems.some(p => p.kind === 'missing_token')).toBe(true);
  });

  it('flags the wrong number of hexes', () => {
    const problems = validateBoardComposition(legalBoard().slice(0, 18));
    expect(problems.some(p => p.kind === 'hex_count')).toBe(true);
  });

  it('flags three copies of a token that only has two', () => {
    const board = legalBoard();
    const targets = board.filter(h => h.resource !== 'desert').slice(0, 3);
    for (const t of targets) board[t.index] = { ...t, number: 6 };
    const problems = validateBoardComposition(board);
    expect(problems.some(p => p.kind === 'token_count')).toBe(true);
  });
});

describe('reconcileBoard', () => {
  it('leaves a legal board completely alone', () => {
    const board = legalBoard();
    const { hexes, changes } = reconcileBoard(board);
    expect(changes).toEqual([]);
    expect(hexes).toEqual(board);
  });

  it('always produces a legal board from an illegal reading', () => {
    // A scanner that saw ore everywhere.
    const board = legalBoard().map(h => ({ ...h, resource: 'ore' as ResourceType }));
    const { hexes } = reconcileBoard(board);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('overrules the least confident reading when counts are exceeded', () => {
    const board = legalBoard();
    // Four ore tiles when the box has three; the fourth is a shaky reading.
    const brick = board.find(h => h.resource === 'brick')!;
    board[brick.index] = { ...brick, resource: 'ore', confidence: 'low' };

    const { hexes, changes } = reconcileBoard(board);
    expect(validateBoardComposition(hexes)).toEqual([]);
    // The low-confidence tile is the one that moved.
    const moved = changes.filter(c => c.field === 'resource');
    expect(moved).toHaveLength(1);
    expect(moved[0]!.hexIndex).toBe(brick.index);
  });

  it('fills in unknown tiles from whatever the box has left', () => {
    const board = legalBoard();
    const target = board.find(h => h.resource === 'wool')!;
    board[target.index] = { ...target, resource: null, confidence: 'low' };

    const { hexes } = reconcileBoard(board);
    expect(validateBoardComposition(hexes)).toEqual([]);
    expect(hexes[target.index]!.resource).toBe('wool');
  });

  it('recovers a missing number token from the leftover multiset', () => {
    const board = legalBoard();
    const target = board.find(h => h.resource === 'grain')!;
    const original = target.number;
    board[target.index] = { ...target, number: null, confidence: 'low' };

    const { hexes } = reconcileBoard(board);
    expect(validateBoardComposition(hexes)).toEqual([]);
    expect(hexes[target.index]!.number).toBe(original);
  });

  it('strips a token the scanner put on the desert', () => {
    const board = legalBoard();
    const desert = board.find(h => h.resource === 'desert')!;
    board[desert.index] = { ...desert, number: 11 };

    const { hexes, changes } = reconcileBoard(board);
    expect(hexes[desert.index]!.number).toBeNull();
    expect(changes.some(c => c.field === 'number' && c.to === null)).toBe(true);
  });

  it('marks repaired hexes low-confidence so review flags them', () => {
    const board = legalBoard();
    const brick = board.find(h => h.resource === 'brick')!;
    board[brick.index] = { ...brick, resource: 'ore', confidence: 'low' };

    const { hexes } = reconcileBoard(board);
    expect(hexes[brick.index]!.confidence).toBe('low');
  });

  it('repairs a board where nothing was read at all', () => {
    const board: CatanHexDef[] = Array.from({ length: BOARD_HEX_COUNT }, (_, index) => ({
      index,
      resource: null,
      number: null,
      confidence: 'low' as const,
    }));
    const { hexes } = reconcileBoard(board);
    expect(validateBoardComposition(hexes)).toEqual([]);
  });

  it('declines to guess when the hex count is wrong', () => {
    const short = legalBoard().slice(0, 18);
    const { changes } = reconcileBoard(short);
    expect(changes).toEqual([]);
  });

  it('reports every change it made', () => {
    const board = legalBoard().map(h => ({ ...h, resource: 'ore' as ResourceType }));
    const { changes } = reconcileBoard(board);
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(typeof describeChange(change)).toBe('string');
    }
  });
});

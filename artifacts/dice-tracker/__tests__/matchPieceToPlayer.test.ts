import { matchPieceToPlayer, MATCH_THRESHOLD } from '../utils/matchPieceToPlayer';
import type { Player } from '../types/models';

function makePlayer(id: string, color: string): Player {
  return { id, displayName: id, color, seatNumber: 1, createdAt: '2026-01-01T00:00:00Z' };
}

const RED_PLAYER    = makePlayer('p-red',    '#DC2626');
const BLUE_PLAYER   = makePlayer('p-blue',   '#2563EB');
const WHITE_PLAYER  = makePlayer('p-white',  '#FFFFFF');
const ORANGE_PLAYER = makePlayer('p-orange', '#EA580C');

const PLAYERS = [RED_PLAYER, BLUE_PLAYER, WHITE_PLAYER, ORANGE_PLAYER];

describe('matchPieceToPlayer', () => {
  describe('exact matches', () => {
    it('matches exact hex color', () => {
      expect(matchPieceToPlayer('#DC2626', PLAYERS)).toBe(RED_PLAYER);
      expect(matchPieceToPlayer('#2563EB', PLAYERS)).toBe(BLUE_PLAYER);
    });

    it('matches CSS color name "red" to red player', () => {
      expect(matchPieceToPlayer('red', PLAYERS)).toBe(RED_PLAYER);
    });

    it('matches CSS color name "blue" to blue player', () => {
      expect(matchPieceToPlayer('blue', PLAYERS)).toBe(BLUE_PLAYER);
    });

    it('matches CSS color name "white" to white player', () => {
      expect(matchPieceToPlayer('white', PLAYERS)).toBe(WHITE_PLAYER);
    });

    it('matches CSS color name "orange" to orange player', () => {
      expect(matchPieceToPlayer('orange', PLAYERS)).toBe(ORANGE_PLAYER);
    });
  });

  describe('near matches (within threshold)', () => {
    it('matches a slightly-off red to the red player', () => {
      // #E03030 is close to #DC2626 (distance < 120)
      const result = matchPieceToPlayer('#E03030', PLAYERS);
      expect(result).toBe(RED_PLAYER);
    });

    it('matches shorthand 3-char hex', () => {
      // #F00 = #FF0000 — still closer to red than blue
      const result = matchPieceToPlayer('#F00', PLAYERS);
      expect(result).toBe(RED_PLAYER);
    });

    it('is case-insensitive for hex strings', () => {
      expect(matchPieceToPlayer('#dc2626', PLAYERS)).toBe(RED_PLAYER);
      expect(matchPieceToPlayer('#DC2626', PLAYERS)).toBe(RED_PLAYER);
    });
  });

  describe('no-match threshold', () => {
    it('returns null when no player color is within MATCH_THRESHOLD', () => {
      // Pure green (#00FF00) — no player is close
      const result = matchPieceToPlayer('#00FF00', PLAYERS);
      expect(result).toBeNull();
    });

    it('returns null for empty player list', () => {
      expect(matchPieceToPlayer('#DC2626', [])).toBeNull();
    });

    it('returns null for unparseable color string', () => {
      expect(matchPieceToPlayer('notacolor', PLAYERS)).toBeNull();
      expect(matchPieceToPlayer('', PLAYERS)).toBeNull();
      expect(matchPieceToPlayer('#GGGGGG', PLAYERS)).toBeNull();
    });

    it('MATCH_THRESHOLD is exported and equals 120', () => {
      expect(MATCH_THRESHOLD).toBe(120);
    });
  });

  describe('multiple pieces for the same player', () => {
    it('consistently returns the same player for two pieces of the same color', () => {
      const r1 = matchPieceToPlayer('#DC2626', PLAYERS);
      const r2 = matchPieceToPlayer('#DC2626', PLAYERS);
      expect(r1).toBe(RED_PLAYER);
      expect(r2).toBe(RED_PLAYER);
    });

    it('differentiates two similar-but-distinct colors', () => {
      // Red vs orange — both close-ish, but should resolve to their nearest player
      const redResult    = matchPieceToPlayer('#DC2626', PLAYERS);
      const orangeResult = matchPieceToPlayer('#EA580C', PLAYERS);
      expect(redResult).toBe(RED_PLAYER);
      expect(orangeResult).toBe(ORANGE_PLAYER);
    });
  });

  describe('single-player list', () => {
    it('returns that player when within threshold', () => {
      expect(matchPieceToPlayer('#DC2626', [RED_PLAYER])).toBe(RED_PLAYER);
    });

    it('returns null when beyond threshold', () => {
      // #00FF00 is very far from red
      expect(matchPieceToPlayer('#00FF00', [RED_PLAYER])).toBeNull();
    });
  });
});

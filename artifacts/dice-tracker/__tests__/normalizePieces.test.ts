import { normalizePieces } from '../utils/normalizePieces';

describe('normalizePieces', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizePieces(null)).toEqual([]);
    expect(normalizePieces(undefined)).toEqual([]);
    expect(normalizePieces({})).toEqual([]);
    expect(normalizePieces('string')).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(normalizePieces([])).toEqual([]);
  });

  it('accepts valid piece with hex color', () => {
    expect(normalizePieces([{ hexIndex: 5, color: '#FF0000' }])).toEqual([
      { hexIndex: 5, color: '#FF0000' },
    ]);
  });

  it('accepts valid piece with CSS color name', () => {
    expect(normalizePieces([{ hexIndex: 0, color: 'red' }])).toEqual([
      { hexIndex: 0, color: 'red' },
    ]);
  });

  it('accepts boundary indices 0 and 18', () => {
    const result = normalizePieces([
      { hexIndex: 0, color: '#111' },
      { hexIndex: 18, color: '#222' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.hexIndex).toBe(0);
    expect(result[1]!.hexIndex).toBe(18);
  });

  it('drops pieces with hexIndex out of 0–18 range', () => {
    expect(normalizePieces([
      { hexIndex: -1, color: '#FF0000' },
      { hexIndex: 19, color: '#FF0000' },
      { hexIndex: 100, color: '#FF0000' },
    ])).toEqual([]);
  });

  it('rounds non-integer hexIndex values', () => {
    const result = normalizePieces([{ hexIndex: 4.7, color: '#FF0000' }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.hexIndex).toBe(5);
  });

  it('drops pieces missing hexIndex', () => {
    expect(normalizePieces([{ color: '#FF0000' }])).toEqual([]);
  });

  it('drops pieces with non-number hexIndex', () => {
    expect(normalizePieces([{ hexIndex: '5', color: '#FF0000' }])).toEqual([]);
  });

  it('drops pieces missing color', () => {
    expect(normalizePieces([{ hexIndex: 5 }])).toEqual([]);
  });

  it('drops pieces with empty color string', () => {
    expect(normalizePieces([{ hexIndex: 5, color: '' }])).toEqual([]);
  });

  it('drops pieces with non-string color', () => {
    expect(normalizePieces([{ hexIndex: 5, color: 42 }])).toEqual([]);
  });

  it('trims whitespace from color', () => {
    const result = normalizePieces([{ hexIndex: 3, color: '  #FF0000  ' }]);
    expect(result[0]!.color).toBe('#FF0000');
  });

  it('allows duplicate hex indices (multiple pieces on same hex)', () => {
    const result = normalizePieces([
      { hexIndex: 7, color: '#FF0000' },
      { hexIndex: 7, color: '#0000FF' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('silently drops invalid entries and keeps valid ones', () => {
    const result = normalizePieces([
      { hexIndex: 2, color: '#FF0000' },
      { hexIndex: -1, color: '#FF0000' },
      null,
      'bad',
      { hexIndex: 14, color: 'blue' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.hexIndex).toBe(2);
    expect(result[1]!.hexIndex).toBe(14);
  });
});

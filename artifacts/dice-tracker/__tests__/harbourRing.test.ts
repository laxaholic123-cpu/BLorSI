/**
 * The coastal ring that harbour detection is scored against. Frame selection
 * is covered in harbourFrame.test.ts.
 */

import {
  COASTAL_RING,
  edgeKey,
} from '@/services/vision/harbourRing';
import { COASTAL_EDGE_COUNT, isCoastalEdge } from '@/services/catanBoard';

describe('the coastal ring', () => {
  it('is every coastal edge, once', () => {
    expect(COASTAL_RING).toHaveLength(COASTAL_EDGE_COUNT);
    const keys = new Set(COASTAL_RING.map(s => edgeKey(s.hexIndex, s.edge)));
    expect(keys.size).toBe(COASTAL_EDGE_COUNT);
  });

  it('contains only edges that actually face the sea', () => {
    for (const s of COASTAL_RING) {
      expect(isCoastalEdge(s.hexIndex, s.edge)).toBe(true);
    }
  });
});

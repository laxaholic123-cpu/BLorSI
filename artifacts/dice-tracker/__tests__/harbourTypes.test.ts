/**
 * Harbour type classification.
 *
 * The accuracy number lives where it can be honest — `tools/harbour_type_check.mjs`
 * runs the shipped module over the real photos and reproduces the probe's
 * 92.2% exactly, feature for feature. These tests pin the things that must hold
 * for ANY input, which is what a unit test can actually prove: that the answer
 * is always a legal board, and that the assignment is exhaustive rather than
 * greedy.
 */

import {
  FEATURE_NAMES,
  PORT_SLOTS,
  TYPE_PROFILES,
  assignTypes,
  cardFeatures,
  typeDistance,
} from '@/services/vision/harbourTypes';
import { PORT_TYPE_COUNTS } from '@/services/catanBoard';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import type { PortType } from '@/types/models';

const TYPES: PortType[] = ['generic', 'brick', 'lumber', 'grain', 'ore', 'wool'];

const tally = (types: readonly PortType[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
};

/** The bag the box actually contains. */
const LEGAL_BAG = { generic: 4, brick: 1, lumber: 1, grain: 1, ore: 1, wool: 1 };

/** A flat patch of one colour, for the decline cases. */
const flat = (r: number, g: number, b: number, size = 96): PixelBuffer => {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { data, width: size, height: size };
};

describe('the bundled profiles', () => {
  it('cover every harbour type, with one value per feature', () => {
    for (const t of TYPES) {
      expect(TYPE_PROFILES[t]).toBeDefined();
      expect(TYPE_PROFILES[t]).toHaveLength(FEATURE_NAMES.length);
    }
  });

  it('describes the box, not a board someone happened to photograph', () => {
    expect(tally(PORT_SLOTS)).toEqual(LEGAL_BAG);
    expect(LEGAL_BAG.generic).toBe(PORT_TYPE_COUNTS.generic);
  });

  it('separates the types it is meant to tell apart', () => {
    // Every profile must be closer to itself than to any other. If two
    // collapsed together the classifier could never distinguish them, and the
    // constraint would be papering over a dead feature set.
    for (const t of TYPES) {
      const self = typeDistance(TYPE_PROFILES[t]!, t);
      expect(self).toBeCloseTo(0, 10);
      for (const other of TYPES) {
        if (other === t) continue;
        expect(typeDistance(TYPE_PROFILES[t]!, other)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('assignTypes', () => {
  it('recovers the types when each badge matches a profile exactly', () => {
    const feats = PORT_SLOTS.map(t => TYPE_PROFILES[t]!);
    expect(assignTypes(feats).types).toEqual([...PORT_SLOTS]);
  });

  it('ALWAYS returns a legal bag, whatever the features say', () => {
    /*
      The constraint's whole value. Nine badges that all look like ore cannot
      produce a board with nine ore harbours, because that board does not exist
      in the box. Worth 12 points of accuracy on the real photos (92.2% against
      80.0%) and, more importantly, it means a bad photo degrades into a
      plausible board rather than an impossible one.
    */
    const cases: (readonly number[] | null)[][] = [
      Array(9).fill(TYPE_PROFILES.ore!),
      Array(9).fill(TYPE_PROFILES.generic!),
      Array(9).fill(FEATURE_NAMES.map(() => 0)),
      Array(9).fill(FEATURE_NAMES.map(() => 999)),
      Array(9).fill(null),
    ];
    for (const feats of cases) {
      expect(tally(assignTypes(feats).types)).toEqual(LEGAL_BAG);
    }
  });

  it('is EXHAUSTIVE, not greedy — it will not spend a slot early', () => {
    /*
      Two badges both look most like ore, and the one that appears first is the
      WORSE match. A greedy pass hands ore to whichever it sees first and then
      has to place the better candidate somewhere expensive. The exhaustive
      search spends the single ore slot on the badge that earns it.
    */
    const near = (t: PortType, k: number) => TYPE_PROFILES[t]!.map(v => v + k);
    const feats = [
      near('ore', 0.05),   // decent ore, seen first
      near('ore', 0.001),  // better ore, seen second
      TYPE_PROFILES.brick!,
      TYPE_PROFILES.lumber!,
      TYPE_PROFILES.grain!,
      TYPE_PROFILES.wool!,
      TYPE_PROFILES.generic!,
      TYPE_PROFILES.generic!,
      TYPE_PROFILES.generic!,
    ];
    const got = assignTypes(feats);
    expect(got.types[1]).toBe('ore');
    expect(got.types[0]).toBe('generic');
    expect(tally(got.types)).toEqual(LEGAL_BAG);
  });

  it('reports a margin, so a coin-toss read can be shown as one', () => {
    const clean = assignTypes(PORT_SLOTS.map(t => TYPE_PROFILES[t]!));
    expect(clean.margin).toBeGreaterThan(0);

    // Nine identical badges: every labelling costs the same, so nothing was
    // decided and the margin has to say so.
    const flatFeat = assignTypes(Array(9).fill(TYPE_PROFILES.generic!));
    expect(flatFeat.margin).toBeCloseTo(0, 9);
  });

  it('costs nothing extra to be sure — the search is small', () => {
    // 9!/4! = 15120 labellings. Pinned because a change that made this
    // exponential would still pass every other test here.
    const t0 = Date.now();
    assignTypes(PORT_SLOTS.map(t => TYPE_PROFILES[t]!));
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('cardFeatures', () => {
  it('declines a patch that is all sea', () => {
    // No card in frame at all. Declining is right; inventing features for open
    // water is how a badge that was never there gets a confident label.
    expect(cardFeatures(flat(40, 100, 190))).toBeNull();
  });

  it('declines a patch that is all dark', () => {
    expect(cardFeatures(flat(10, 10, 10))).toBeNull();
  });

  it('describes a plain cream card as having almost no icon', () => {
    // A 3:1 harbour is a card with no resource picture on it, so the icon
    // fraction is what separates generic from everything else.
    const f = cardFeatures(flat(235, 225, 195));
    expect(f).not.toBeNull();
    expect(f).toHaveLength(FEATURE_NAMES.length);
    expect(f![0]).toBeLessThan(0.05);
  });

  it('returns every feature as a finite number', () => {
    // A NaN here would poison every distance and make the assignment arbitrary
    // without failing anything visibly.
    const buf = flat(235, 225, 195);
    // Paint a dark blob in the middle: a resource icon on the card.
    for (let y = 40; y < 56; y++) {
      for (let x = 40; x < 56; x++) {
        const i = (y * 96 + x) * 4;
        buf.data[i] = 150; buf.data[i + 1] = 60; buf.data[i + 2] = 40;
      }
    }
    const f = cardFeatures(buf)!;
    expect(f).not.toBeNull();
    for (const v of f) expect(Number.isFinite(v)).toBe(true);
    expect(f[0]).toBeGreaterThan(0);
  });
});

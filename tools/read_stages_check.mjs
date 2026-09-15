/**
 * Two questions before building a progressive read and a guided second shot.
 *
 * 1. WHERE does a read spend its time? That decides how finely the board can
 *    fill in on screen while it reads: if colour is cheap and tokens are dear,
 *    tiles can appear first and numbers after.
 * 2. Does a second shot help, and can a bad one hurt? Tiles and numbers already
 *    merge across shots. This measures it on real frames: the light moved
 *    between shots, two different photos merged, and a second shot whose
 *    corners are off by a little, which is what the old live loop suffered.
 *
 * Tile key is the even-light majority reading (a proxy; see light_read_check).
 *
 *   node tools/read_stages_check.mjs
 */
import { readFileSync } from "node:fs";
import { readFrame } from "../artifacts/dice-tracker/dist-portcheck/readFrame.js";
import { reconcileBoardFromEvidence } from "../artifacts/dice-tracker/dist-portcheck/boardConstraints.js";
import { balanceForBoard } from "../artifacts/dice-tracker/dist-portcheck/whiteBalance.js";
import { readHarbours } from "../artifacts/dice-tracker/dist-portcheck/harbours.js";
import { mergeEvidence, emptyEvidence, guidanceForEvidence } from "../artifacts/dice-tracker/dist-portcheck/evidenceMerge.js";

const TRUTH_NUM = [4, 11, 6, 5, 10, 11, 12, 4, 5, null, 8, 10, 2, 9, 3, 3, 6, 8, 9];
const meta = JSON.parse(readFileSync("tools/frames.json", "utf8"));
const raw = readFileSync("tools/frames.bin");
const LEFT = { gains: [1.25, 1.02, 0.6], side: "left" };
const RIGHT = { gains: [1.25, 1.02, 0.6], side: "right" };

function frame(m, cast) {
  const { width, height, offset } = m;
  const data = new Uint8Array(width * height * 4);
  const [gr, gg, gb] = cast ? cast.gains : [1, 1, 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let k = 0;
      if (cast && cast.side === "left") k = Math.min(1, Math.max(0, (width * 0.6 - x) / (width * 0.25)));
      if (cast && cast.side === "right") k = Math.min(1, Math.max(0, (x - width * 0.4) / (width * 0.25)));
      const s = offset + (y * width + x) * 3;
      const d = (y * width + x) * 4;
      data[d] = Math.min(255, Math.round(raw[s] * (1 + (gr - 1) * k)));
      data[d + 1] = Math.min(255, Math.round(raw[s + 1] * (1 + (gg - 1) * k)));
      data[d + 2] = Math.min(255, Math.round(raw[s + 2] * (1 + (gb - 1) * k)));
      data[d + 3] = 255;
    }
  }
  return { data, width, height };
}

const cornersOf = (m, shift = 0) => m.corners.map(([x, y]) => ({ x: x + shift * m.width, y }));
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ── 1. Where the time goes ──────────────────────────────────────────────────
const T = { balance: [], colourOnly: [], fullRead: [], reconcile: [], harbours: [] };
for (const m of meta) {
  const c = cornersOf(m);
  const img = frame(m, null);
  let t = performance.now();
  const bal = balanceForBoard(img, c);
  T.balance.push(performance.now() - t);
  t = performance.now();
  readFrame(bal, c, { decodeTokensFor: [] });
  T.colourOnly.push(performance.now() - t);
  t = performance.now();
  const r = readFrame(bal, c);
  T.fullRead.push(performance.now() - t);
  t = performance.now();
  reconcileBoardFromEvidence(r.evidence);
  T.reconcile.push(performance.now() - t);
  t = performance.now();
  readHarbours(bal, c, img);
  T.harbours.push(performance.now() - t);
}
console.log(`STAGE TIMES (median ms, desktop, ${meta[0].width}x${meta[0].height})`);
for (const [k, v] of Object.entries(T)) console.log(`  ${k.padEnd(11)} ${median(v).toFixed(0).padStart(6)}`);
console.log(`  numbers alone = fullRead - colourOnly = ${(median(T.fullRead) - median(T.colourOnly)).toFixed(0)}`);

// ── 2. Does a second shot help, and can a bad one hurt? ─────────────────────
const key = (() => {
  const base = meta.map(m => {
    const r = readFrame(frame(m, null), cornersOf(m));
    return reconcileBoardFromEvidence(r.evidence).hexes;
  });
  return base[0].map((_h, i) => {
    const votes = {};
    for (const b of base) votes[b[i].resource] = (votes[b[i].resource] ?? 0) + 1;
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  });
})();

function evidenceOf(m, cast, shift = 0) {
  const c = cornersOf(m, shift);
  const img = frame(m, cast);
  const r = readFrame(balanceForBoard(img, c), c);
  return r.evidence.length ? r.evidence : null;
}
const merge = (...shots) => shots.filter(Boolean).reduce((acc, e) => mergeEvidence(acc, e), emptyEvidence());

function score(evidence) {
  const hexes = reconcileBoardFromEvidence(evidence).hexes;
  let tiles = 0, nums = 0;
  hexes.forEach((h, i) => {
    if (h.resource === key[i]) tiles++;
    if (TRUTH_NUM[i] !== null && h.number === TRUTH_NUM[i]) nums++;
  });
  return { tiles, nums, weak: guidanceForEvidence(evidence).weakHexes.length };
}

const cache = meta.map(m => ({
  none: evidenceOf(m, null),
  left: evidenceOf(m, LEFT),
  right: evidenceOf(m, RIGHT),
  shift1: evidenceOf(m, null, 0.01),
  shift3: evidenceOf(m, null, 0.03),
}));

const conditions = [
  ["one shot, even light", i => merge(cache[i].none)],
  ["two photos, even light", i => merge(cache[i].none, cache[(i + 1) % meta.length].none)],
  ["one shot, light on left", i => merge(cache[i].left)],
  ["one shot, light on right", i => merge(cache[i].right)],
  ["two shots, light moved", i => merge(cache[i].left, cache[i].right)],
  ["one shot, corners off 1%", i => merge(cache[i].shift1)],
  ["one shot, corners off 3%", i => merge(cache[i].shift3)],
  ["good + 1% off shot", i => merge(cache[i].none, cache[i].shift1)],
  ["good + 3% off shot", i => merge(cache[i].none, cache[i].shift3)],
];
const n = meta.length;
console.log(`\nMERGING (balanced reads, ${n} boards)`);
console.log(`  ${"condition".padEnd(26)} ${"tiles".padStart(8)} ${"numbers".padStart(8)} ${"unclear".padStart(8)}`);
for (const [name, build] of conditions) {
  let tiles = 0, nums = 0, weak = 0;
  for (let i = 0; i < n; i++) {
    const s = score(build(i));
    tiles += s.tiles; nums += s.nums; weak += s.weak;
  }
  console.log(`  ${name.padEnd(26)} ${`${tiles}/${19 * n}`.padStart(8)} ${`${nums}/${18 * n}`.padStart(8)} ${(weak / n).toFixed(1).padStart(8)}`);
}

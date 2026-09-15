/**
 * Can the corners be placed automatically from a rough guide position?
 *
 * No record exists of how far off the capture guide's corners land on a real
 * phone: every vision measurement so far used hand-marked corners. So this
 * perturbs the hand-marked corners of the seven reference frames the way a
 * hand-aimed guide would be off, runs refineCorners, and asks:
 *
 *   1. Do the refined corners land back on the hand-marked ones?
 *   2. Does the board read as well from refined corners? That is the one that
 *      matters: corners 1% off already cost numbers (126 -> 118 of 126).
 *   3. Is there a score that separates refinements that worked from ones that
 *      did not? Needed before the corner step could ever be hidden.
 *
 * HISTORY OF THIS FILE'S RESULTS
 *   token ink + sea ring:  corners ended WORSE than the guide (0.13 -> 0.19).
 *   coastline, unscaled:   converged to 0.18 off from every start. Bias: from
 *                          the hand-marked corners it stretched the lattice 5%.
 *   coastline, scaled:     this run. The scale is fitted LEAVE-ONE-OUT — each
 *                          frame is refined with the stretch measured on the
 *                          other six — so no frame is scored with its own fit.
 *
 * All seven frames are the same physical board, so even the leave-one-out
 * number cannot say whether another set's frame sits the same way.
 *
 *   node tools/corner_refine_check.mjs
 */
import { readFileSync } from "node:fs";
import { readFrame } from "../artifacts/dice-tracker/dist-portcheck/readFrame.js";
import { reconcileBoardFromEvidence } from "../artifacts/dice-tracker/dist-portcheck/boardConstraints.js";
import { balanceForBoard } from "../artifacts/dice-tracker/dist-portcheck/whiteBalance.js";
import { refineCorners } from "../artifacts/dice-tracker/dist-portcheck/cornerRefine.js";

const TRUTH_NUM = [4, 11, 6, 5, 10, 11, 12, 4, 5, null, 8, 10, 2, 9, 3, 3, 6, 8, 9];
const meta = JSON.parse(readFileSync("tools/frames.json", "utf8"));
const raw = readFileSync("tools/frames.bin");
const MAGS = [0.15, 0.35, 0.6];
const TRIALS = 3;
const BASE = { coastWeight: 1, coastOffset: 0.1, seaWeight: 0, tokenWeight: 0 };

function frame(m) {
  const data = new Uint8Array(m.width * m.height * 4);
  for (let i = 0; i < m.width * m.height; i++) {
    data[i * 4] = raw[m.offset + i * 3];
    data[i * 4 + 1] = raw[m.offset + i * 3 + 1];
    data[i * 4 + 2] = raw[m.offset + i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: m.width, height: m.height };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hex radius in pixels, from hand-marked corners (hex 0 to hex 2 is 2*sqrt3). */
const radiusOf = c => Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) / (2 * Math.sqrt(3));
const centroid = c => ({ x: c.reduce((s, p) => s + p.x, 0) / 4, y: c.reduce((s, p) => s + p.y, 0) / 4 });

/** A guide-like error: shift, scale, turn, plus per-corner tilt, sized in hex radii. */
function perturb(c, mag, rand) {
  const r = radiusOf(c);
  const { x: cx, y: cy } = centroid(c);
  const ang = rand() * 2 * Math.PI;
  const shift = mag * r * Math.sqrt(rand());
  const s = 1 + (rand() * 2 - 1) * mag * 0.12;
  const th = ((rand() * 2 - 1) * mag * 8 * Math.PI) / 180;
  return c.map(p => {
    const dx = p.x - cx, dy = p.y - cy;
    return {
      x: cx + shift * Math.cos(ang) + s * (Math.cos(th) * dx - Math.sin(th) * dy) + (rand() * 2 - 1) * mag * 0.5 * r,
      y: cy + shift * Math.sin(ang) + s * (Math.sin(th) * dx + Math.cos(th) * dy) + (rand() * 2 - 1) * mag * 0.5 * r,
    };
  });
}

const cornerError = (a, b) =>
  a.reduce((s, p, i) => s + Math.hypot(p.x - b[i].x, p.y - b[i].y), 0) / 4 / radiusOf(b);

function readWith(img, corners) {
  const r = readFrame(balanceForBoard(img, corners), corners);
  if (r.evidence.length === 0) return null;
  return reconcileBoardFromEvidence(r.evidence).hexes;
}

const images = meta.map(frame);
const truths = meta.map(m => m.corners.map(([x, y]) => ({ x, y })));
const baseBoards = images.map((img, i) => readWith(img, truths[i]));
const key = baseBoards[0].map((_h, i) => {
  const votes = {};
  for (const b of baseBoards) if (b) votes[b[i].resource] = (votes[b[i].resource] ?? 0) + 1;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
});
const score = hexes => {
  if (!hexes) return { tiles: 0, nums: 0 };
  let tiles = 0, nums = 0;
  hexes.forEach((h, i) => {
    if (h.resource === key[i]) tiles++;
    if (TRUTH_NUM[i] !== null && h.number === TRUTH_NUM[i]) nums++;
  });
  return { tiles, nums };
};

let tt = 0, tn = 0;
for (const b of baseBoards) { const s = score(b); tt += s.tiles; tn += s.nums; }
console.log(`hand-marked corners: tiles ${tt}/${19 * meta.length}, numbers ${tn}/${18 * meta.length}\n`);

// ── How far each frame's real coast sits outside the ideal grid ─────────────
// Refine FROM the hand-marked corners with no scale, and measure the stretch.
const stretch = meta.map((_m, f) => {
  const res = refineCorners(images[f], truths[f], { ...BASE, coastScale: 1 });
  const c = centroid(truths[f]);
  return res.corners.reduce((s, p, i) =>
    s + Math.hypot(p.x - c.x, p.y - c.y) / Math.hypot(truths[f][i].x - c.x, truths[f][i].y - c.y), 0) / 4;
});
console.log("measured coast stretch per frame:", stretch.map(s => s.toFixed(3)).join(" "));
const looScale = f => stretch.filter((_s, i) => i !== f).reduce((a, b) => a + b, 0) / (stretch.length - 1);
console.log("leave-one-out scales:           ", meta.map((_m, f) => looScale(f).toFixed(3)).join(" "), "\n");

const seeds = {};
for (const mag of MAGS) {
  const rand = rng(1000 + Math.round(mag * 100));
  seeds[mag] = meta.map((_m, f) => Array.from({ length: TRIALS }, () => perturb(truths[f], mag, rand)));
}

const VARIANTS = {
  "unscaled": () => ({ ...BASE, coastScale: 1 }),
  "scaled, leave-one-out": f => ({ ...BASE, coastScale: looScale(f) }),
};

console.log("variant                 guide  before  after  worst  within0.1  tiles     numbers   score(ok)  score(bad)  ms");
for (const [name, optsFor] of Object.entries(VARIANTS)) {
  for (const mag of MAGS) {
    let before = 0, after = 0, worst = 0, within = 0, tiles = 0, nums = 0, ms = 0, n = 0;
    const ok = [], bad = [];
    for (let f = 0; f < meta.length; f++) {
      for (const seed of seeds[mag][f]) {
        const t0 = performance.now();
        const res = refineCorners(images[f], seed, optsFor(f));
        ms += performance.now() - t0;
        const eb = cornerError(seed, truths[f]);
        const ea = cornerError(res.corners, truths[f]);
        before += eb; after += ea; worst = Math.max(worst, ea);
        if (ea <= 0.1) { within++; ok.push(res.score.total); } else bad.push(res.score.total);
        const s = score(readWith(images[f], res.corners));
        tiles += s.tiles; nums += s.nums;
        n++;
      }
    }
    const avg = xs => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : "  -  ");
    console.log(
      `${name.padEnd(22)}  ${String(mag).padEnd(5)}  ${(before / n).toFixed(2)}   ${(after / n).toFixed(3)}  ${worst.toFixed(2)}   ` +
      `${`${within}/${n}`.padStart(7)}   ${`${tiles}/${19 * n}`.padStart(7)}  ${`${nums}/${18 * n}`.padStart(7)}   ` +
      `${avg(ok).padStart(8)}   ${avg(bad).padStart(8)}   ${(ms / n).toFixed(0)}`,
    );
  }
}
console.log("\nerrors: mean corner distance in hex radii. score(ok)/score(bad): final score of refinements that did / did not land within 0.1");

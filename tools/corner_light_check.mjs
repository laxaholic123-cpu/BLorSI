/**
 * Does automatic corner placement survive golden light?
 *
 * Refinement runs on the RAW photo: white balance needs the token faces, and
 * the token faces need the corners, so the corners have to come first. A warm
 * cast shrinks the tile-to-sea blueness step the coastline score relies on, so
 * this checks it under the same casts the reader was tested with, at a medium
 * guide error. The coast scale is the default fitted on all seven frames, so
 * these numbers are slightly optimistic against the leave-one-out ones.
 *
 *   node tools/corner_light_check.mjs
 */
import { readFileSync } from "node:fs";
import { refineCorners, DEFAULT_REFINE } from "../artifacts/dice-tracker/dist-portcheck/cornerRefine.js";

const meta = JSON.parse(readFileSync("tools/frames.json", "utf8"));
const raw = readFileSync("tools/frames.bin");
const CASTS = {
  none: null,
  warm: { gains: [1.12, 1.0, 0.78] },
  strong: { gains: [1.25, 1.02, 0.6] },
  half: { gains: [1.25, 1.02, 0.6], half: true },
};

function frame(m, cast) {
  const { width, height, offset } = m;
  const data = new Uint8Array(width * height * 4);
  const [gr, gg, gb] = cast ? cast.gains : [1, 1, 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = !cast ? 0 : cast.half ? Math.min(1, Math.max(0, (width * 0.6 - x) / (width * 0.25))) : 1;
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
const radiusOf = c => Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) / (2 * Math.sqrt(3));
function perturb(c, mag, rand) {
  const r = radiusOf(c);
  const cx = c.reduce((s, p) => s + p.x, 0) / 4, cy = c.reduce((s, p) => s + p.y, 0) / 4;
  const ang = rand() * 2 * Math.PI, shift = mag * r * Math.sqrt(rand());
  const s = 1 + (rand() * 2 - 1) * mag * 0.12, th = ((rand() * 2 - 1) * mag * 8 * Math.PI) / 180;
  return c.map(p => {
    const dx = p.x - cx, dy = p.y - cy;
    return {
      x: cx + shift * Math.cos(ang) + s * (Math.cos(th) * dx - Math.sin(th) * dy) + (rand() * 2 - 1) * mag * 0.5 * r,
      y: cy + shift * Math.sin(ang) + s * (Math.sin(th) * dx + Math.cos(th) * dy) + (rand() * 2 - 1) * mag * 0.5 * r,
    };
  });
}
const cornerError = (a, b) => a.reduce((s, p, i) => s + Math.hypot(p.x - b[i].x, p.y - b[i].y), 0) / 4 / radiusOf(b);

const truths = meta.map(m => m.corners.map(([x, y]) => ({ x, y })));
const rand = rng(4242);
const seeds = meta.map((_m, f) => Array.from({ length: 3 }, () => perturb(truths[f], 0.35, rand)));

console.log("cast     before  after  worst  within0.1  coast score");
for (const [name, cast] of Object.entries(CASTS)) {
  let before = 0, after = 0, worst = 0, within = 0, coast = 0, n = 0;
  for (let f = 0; f < meta.length; f++) {
    const img = frame(meta[f], cast);
    for (const seed of seeds[f]) {
      const res = refineCorners(img, seed, DEFAULT_REFINE);
      const ea = cornerError(res.corners, truths[f]);
      before += cornerError(seed, truths[f]); after += ea; worst = Math.max(worst, ea);
      if (ea <= 0.1) within++;
      coast += res.score.coast; n++;
    }
  }
  console.log(`${name.padEnd(7)}  ${(before / n).toFixed(2)}    ${(after / n).toFixed(3)}  ${worst.toFixed(2)}   ${`${within}/${n}`.padStart(7)}     ${(coast / n).toFixed(3)}`);
}

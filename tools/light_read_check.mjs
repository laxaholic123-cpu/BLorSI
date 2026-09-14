/**
 * Does the shipped TILE and NUMBER reader survive golden light — and does the
 * token-face white balance fix it without breaking even light?
 *
 * Reported from a device: three tiles read wrong on a board lit by golden
 * light. This replays the seven reference captures through the real
 * `readFrame` + `reconcileBoardFromEvidence`, under simulated warm casts, with
 * and without `balanceForBoard`.
 *
 * TILE ANSWER KEY IS A PROXY, and says so. The terrain truth in
 * tools/method_bench.py turned out to belong to a different board: it disagreed
 * with 16 of 19 hexes on every capture while the NUMBERS on the same frames were
 * 126/126. So tiles are scored against the majority reading of the seven
 * captures in even light, unbalanced. That measures what light does to the
 * reader; it cannot catch a hex the reader gets wrong in every photo.
 *
 * Numbers use the real board_shots truth. They are the template reader only —
 * OCR runs afterwards on a phone — so the number column is a floor.
 *
 *   python tools/dump_frames.py
 *   cd artifacts/dice-tracker && npx esbuild services/vision/readFrame.ts \
 *     services/boardConstraints.ts services/vision/whiteBalance.ts --bundle \
 *     --splitting --format=esm --outdir=dist-portcheck --entry-names=[name] --alias:@=.
 *   node tools/light_read_check.mjs
 */
import { readFileSync } from 'node:fs';
import { readFrame } from '../artifacts/dice-tracker/dist-portcheck/readFrame.js';
import { reconcileBoardFromEvidence }
  from '../artifacts/dice-tracker/dist-portcheck/boardConstraints.js';
import { balanceForBoard } from '../artifacts/dice-tracker/dist-portcheck/whiteBalance.js';

/** tools/board_shots.py */
const TRUTH_NUM = [4, 11, 6, 5, 10, 11, 12, 4, 5, null, 8, 10, 2, 9, 3, 3, 6, 8, 9];

const CASTS = {
  none: null,
  warm: { gains: [1.12, 1.0, 0.78] },
  strong: { gains: [1.25, 1.02, 0.6] },
  half: { gains: [1.25, 1.02, 0.6], half: true },
};

const meta = JSON.parse(readFileSync('tools/frames.json', 'utf8'));
const raw = readFileSync('tools/frames.bin');

function frame(m, cast) {
  const { width, height, offset } = m;
  const data = new Uint8Array(width * height * 4);
  const [gr, gg, gb] = cast ? cast.gains : [1, 1, 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = !cast ? 0 : cast.half
        ? Math.min(1, Math.max(0, (width * 0.6 - x) / (width * 0.25)))
        : 1;
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

let balanceMs = 0, balanceRuns = 0;
function read(m, cast, wb) {
  const corners = m.corners.map(([x, y]) => ({ x, y }));
  let buf = frame(m, cast);
  if (wb) {
    const t0 = performance.now();
    buf = balanceForBoard(buf, corners);
    balanceMs += performance.now() - t0;
    balanceRuns++;
  }
  const reading = readFrame(buf, corners);
  if (reading.evidence.length === 0) return null;
  return reconcileBoardFromEvidence(reading.evidence).hexes;
}

const base = meta.map(m => read(m, null, false));
const TRUTH_RES = base[0].map((_h, i) => {
  const votes = {};
  for (const b of base) if (b) votes[b[i].resource] = (votes[b[i].resource] ?? 0) + 1;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
});
console.log('tile key (even-light majority):', TRUTH_RES.map(r => r.slice(0, 3)).join(' '));

console.log(`\n${'cast'.padEnd(7)} ${'wb'.padEnd(4)} ${'tiles'.padStart(8)} ${'numbers'.padStart(8)}  rejected`);
for (const [name, cast] of Object.entries(CASTS)) {
  for (const wb of [false, true]) {
    let tiles = 0, nums = 0, rejected = 0;
    for (const m of meta) {
      const hexes = read(m, cast, wb);
      if (!hexes) { rejected++; continue; }
      hexes.forEach((h, i) => {
        if (h.resource === TRUTH_RES[i]) tiles++;
        if (TRUTH_NUM[i] !== null && h.number === TRUTH_NUM[i]) nums++;
      });
    }
    const n = meta.length;
    console.log(`${name.padEnd(7)} ${(wb ? 'on' : 'off').padEnd(4)} ` +
      `${`${tiles}/${19 * n}`.padStart(8)} ${`${nums}/${18 * n}`.padStart(8)}  ${String(rejected).padStart(8)}`);
  }
}
console.log(`\nbalanceForBoard: ${(balanceMs / Math.max(1, balanceRuns)).toFixed(0)}ms per frame ` +
  `at ${meta[0].width}x${meta[0].height} (desktop node; a phone is slower)`);

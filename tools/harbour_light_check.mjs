/**
 * Do the SHIPPED harbour reader's positions survive golden light, and which
 * photo should types be read from?
 *
 * Python measured the approach (`tools/light_probe.py`); this checks the port
 * does what that measured. Positions are scored against the frame truth for the
 * reference board. Types are scored against the known board, but the bundled
 * profiles were trained on these same captures, so the type numbers are
 * OPTIMISTIC: use them to compare the two photo sources, not as an accuracy
 * claim.
 *
 *   python tools/dump_frames.py
 *   cd artifacts/dice-tracker && npx esbuild services/vision/harbours.ts \
 *     services/vision/whiteBalance.ts --bundle --splitting --format=esm \
 *     --outdir=dist-portcheck --entry-names=[name] --alias:@=.
 *   node tools/harbour_light_check.mjs
 */
import { readFileSync } from 'node:fs';
import { readHarbours } from '../artifacts/dice-tracker/dist-portcheck/harbours.js';
import { balanceForBoard } from '../artifacts/dice-tracker/dist-portcheck/whiteBalance.js';

const TRUTH_TYPES = {
  '0:0': 'generic', '1:1': 'brick', '6:1': 'lumber', '11:2': 'generic', '15:3': 'grain',
  '17:3': 'ore', '16:4': 'generic', '12:5': 'wool', '3:5': 'generic',
};
const TRUTH = Object.keys(TRUTH_TYPES).sort().join(' ');

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

const typeHits = hb =>
  hb.slots.filter((s, i) => TRUTH_TYPES[`${s.hexIndex}:${s.edge}`] === hb.types[i]).length;

let balMs = 0;
let balN = 0;
console.log('cast        positions  confirmed  types(original)  types(balanced)  min margin');
for (const [name, cast] of Object.entries(CASTS)) {
  for (const wb of [false, true]) {
    let pos = 0, conf = 0, tRaw = 0, tBal = 0, minMargin = Infinity;
    for (const m of meta) {
      const corners = m.corners.map(([x, y]) => ({ x, y }));
      const original = frame(m, cast);
      let posBuf = original;
      if (wb) {
        const t0 = performance.now();
        posBuf = balanceForBoard(original, corners);
        balMs += performance.now() - t0;
        balN++;
      }
      const hb = readHarbours(posBuf, corners, original);
      const key = hb.slots.map(s => `${s.hexIndex}:${s.edge}`).sort().join(' ');
      if (key === TRUTH) pos++;
      if (hb.unsure.length === 0) conf++;
      minMargin = Math.min(minMargin, hb.margin);
      if (key === TRUTH) tRaw += typeHits(hb);
      if (wb && key === TRUTH) tBal += typeHits(readHarbours(posBuf, corners, posBuf));
    }
    const n = meta.length;
    console.log(
      `${(name + (wb ? ' +wb' : '')).padEnd(11)} ${`${pos}/${n}`.padStart(9)} ${`${conf}/${n}`.padStart(10)} ` +
      `${`${tRaw}/${9 * n}`.padStart(16)} ${(wb ? `${tBal}/${9 * n}` : '-').padStart(16)} ` +
      `${minMargin.toFixed(2).padStart(11)}`,
    );
  }
}
console.log(`\nbalanceForBoard ${(balMs / Math.max(1, balN)).toFixed(0)}ms per frame at ${meta[0].width}x${meta[0].height}`);

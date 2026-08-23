/**
 * Does the shipped TypeScript reproduce the Python measurement?
 *
 * The whole approach was measured offline in Python. A port that is subtly
 * different is worth nothing, and the difference would not show up in unit
 * tests — it would show up as "recognition is worse on the phone than the
 * numbers promised" weeks later. So this runs the ACTUAL app modules over the
 * ACTUAL photos, leave-one-photo-out, and the result has to match.
 *
 *   python tools/dump_crops.py && node tools/port_check.mjs
 */
import { readFileSync } from 'node:fs';
import { sampleDigit } from '../artifacts/dice-tracker/dist-portcheck/digitSample.js';
import { matchDigit, resolveSixNine, isTrustworthy }
  from '../artifacts/dice-tracker/dist-portcheck/digitShape.js';

const meta = JSON.parse(readFileSync('tools/crops.json', 'utf8'));
const raw = readFileSync('tools/crops.bin');

/** A PixelBuffer over one crop, matching services/vision/pixelBuffer. */
function bufferFor(entry) {
  const { size, offset } = entry;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = raw[offset + i * 3];
    data[i * 4 + 1] = raw[offset + i * 3 + 1];
    data[i * 4 + 2] = raw[offset + i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: size, height: size };
}

const byPhoto = new Map();
let sampled = 0;
for (const entry of meta) {
  const buffer = bufferFor(entry);
  const s = sampleDigit(buffer, 0, 0, entry.size);
  if (!s) continue;
  sampled++;
  if (!byPhoto.has(entry.photo)) byPhoto.set(entry.photo, []);
  byPhoto.get(entry.photo).push({ ...entry, sample: s });
}
console.log(`sampled ${sampled}/${meta.length} digits`);

let ok = 0, n = 0, acc = 0, accOk = 0;
const wrong = [];
for (const [held, items] of byPhoto) {
  const library = [];
  for (const [other, rows] of byPhoto) {
    if (other === held) continue;
    for (const r of rows) library.push({ value: r.value, bits: r.sample.bits });
  }
  for (const r of items) {
    const m = matchDigit(r.sample.bits, library);
    if (!m) continue;
    const value = resolveSixNine(m.value, r.sample.inkIsRed, r.sample.pipsSuggest);
    n++;
    if (value === r.value) ok++;
    if (value !== null && isTrustworthy(m)) {
      acc++;
      if (value === r.value) accOk++;
      else wrong.push(`${held} hex${r.hex}: wanted ${r.value}, got ${value} (${m.score.toFixed(3)})`);
    }
  }
}
console.log(`OVERALL   ${ok}/${n} (${(100 * ok / n).toFixed(0)}%)`);
console.log(`ACCEPTED  ${accOk}/${acc} (${(100 * accOk / acc).toFixed(1)}% precision), ` +
            `covering ${(100 * acc / n).toFixed(0)}%`);
if (wrong.length) console.log('wrong but accepted:\n  ' + wrong.join('\n  '));

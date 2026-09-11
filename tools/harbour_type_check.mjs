/**
 * Does the shipped TypeScript reproduce the Python harbour-type measurement?
 *
 * Same contract as `tools/port_check.mjs` for the digit reader, and for the
 * same reason: a port that is subtly different is worth nothing, and the
 * difference would never fail a unit test. It would surface weeks later as
 * "the harbours read worse on the phone than the numbers promised".
 *
 * So this runs the ACTUAL shipped module over the ACTUAL rectified badges and
 * checks two separate things:
 *
 *   1. FEATURES — every one of the 13 numbers, against what Python computed on
 *      the identical patch. This is the part that localises a bug. "The answer
 *      changed" tells you nothing; "bin_green drifted on wool" tells you where
 *      to look.
 *   2. ACCURACY — the constrained assignment, leave-one-capture-out, which has
 *      to land on the probe's 92.2%.
 *
 *   python tools/harbour_probe.py dump
 *   cd artifacts/dice-tracker && npx esbuild services/vision/harbourTypes.ts \
 *     --bundle --splitting --format=esm --outdir=dist-portcheck --alias:@=.
 *   node tools/harbour_type_check.mjs
 *
 * The bundle is rebuilt, not reused: a silently failed esbuild once left a
 * harness measuring stale code and reporting 18 phantom mismatches.
 */
import { readFileSync, statSync } from 'node:fs';
import {
  cardFeatures,
  assignTypes,
  typeDistance,
  FEATURE_NAMES,
} from '../artifacts/dice-tracker/dist-portcheck/harbourTypes.js';

const meta = JSON.parse(readFileSync('tools/harbour_patches.json', 'utf8'));
const raw = readFileSync('tools/harbour_patches.bin');
const S = meta.size;

// The stale-bundle guard. A bundle older than the source it claims to be is the
// one failure mode that makes every number below a lie.
const bundleAge = statSync('artifacts/dice-tracker/dist-portcheck/harbourTypes.js').mtimeMs;
const srcAge = statSync('artifacts/dice-tracker/services/vision/harbourTypes.ts').mtimeMs;
if (bundleAge < srcAge) {
  console.error('STALE BUNDLE — harbourTypes.ts is newer than dist-portcheck. Rebuild first.');
  process.exit(1);
}

/** A PixelBuffer over one patch, matching services/vision/pixelBuffer. */
function bufferFor(index) {
  const offset = index * S * S * 3;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = raw[offset + i * 3];
    data[i * 4 + 1] = raw[offset + i * 3 + 1];
    data[i * 4 + 2] = raw[offset + i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: S, height: S };
}

// ── 1. Features, against Python, on identical pixels ────────────────────────
const rows = [];
let worst = 0;
let worstName = '';
const drift = new Map(FEATURE_NAMES.map(n => [n, 0]));

for (let i = 0; i < meta.patches.length; i++) {
  const m = meta.patches[i];
  const got = cardFeatures(bufferFor(i));
  if (m.features === null) {
    if (got !== null) console.log(`  ${m.capture} h${m.hex}e${m.edge}: python declined, TS did not`);
    continue;
  }
  if (got === null) {
    console.log(`  ${m.capture} h${m.hex}e${m.edge}: TS declined, python did not`);
    continue;
  }
  FEATURE_NAMES.forEach((name, k) => {
    const d = Math.abs(got[k] - m.features[name]);
    if (d > drift.get(name)) drift.set(name, d);
    if (d > worst) { worst = d; worstName = `${name} on ${m.capture} h${m.hex}e${m.edge}`; }
  });
  rows.push({ capture: m.capture, truth: m.truth, feature: got, hex: m.hex, edge: m.edge });
}

console.log(`FEATURES: ${rows.length} badges compared against Python`);
console.log(`  largest single difference: ${worst.toExponential(2)}  (${worstName})`);
const bad = [...drift.entries()].filter(([, d]) => d > 1e-6);
if (bad.length === 0) {
  console.log('  every feature matches to 1e-6 — the port is the same computation\n');
} else {
  console.log('  FEATURES THAT DRIFTED:');
  for (const [name, d] of bad.sort((a, b) => b[1] - a[1])) {
    console.log(`    ${name.padEnd(11)} ${d.toExponential(2)}`);
  }
  console.log();
}

// ── 2. Accuracy, leave-one-capture-out ──────────────────────────────────────
//
// The profiles bundled in harbourTypes.ts were trained on ALL captures, so
// using them here would be testing on the training set. This rebuilds the
// profile from the other nine captures each time, which is the number the
// probe reports and the only honest estimate of a new photo.
const captures = [...new Set(rows.map(r => r.capture))];
const TYPES = ['generic', 'brick', 'lumber', 'grain', 'ore', 'wool'];

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length / 2;
  return s.length % 2 ? s[Math.floor(h)] : (s[h - 1] + s[h]) / 2;
};
const quantile = (xs, q) => {
  // Linear interpolation between order statistics — numpy's default, which is
  // what the probe used to derive the scale.
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

let right = 0;
let total = 0;
let unconstrained = 0;

for (const held of captures) {
  const train = rows.filter(r => r.capture !== held);
  const test = rows.filter(r => r.capture === held);
  if (test.length !== 9) {
    console.log(`  ${held}: only ${test.length} badges measurable — skipped`);
    continue;
  }

  const prof = {};
  for (const t of TYPES) {
    const sub = train.filter(r => r.truth === t);
    if (sub.length) prof[t] = FEATURE_NAMES.map((_n, k) => median(sub.map(r => r.feature[k])));
  }
  const scale = FEATURE_NAMES.map((_n, k) => {
    const col = train.map(r => r.feature[k]);
    return Math.max((quantile(col, 0.75) - quantile(col, 0.25)) / 1.35, 1e-3);
  });

  const dist = (v, t) => Math.hypot(...v.map((x, k) => (x - prof[t][k]) / scale[k]));

  // Constrained, via the shipped assignment but with held-out profiles.
  const got = assignTypes(test.map(r => r.feature), { profiles: prof, scale });
  const hits = test.filter((r, i) => r.truth === got.types[i]).length;
  right += hits;
  total += 9;

  for (const r of test) {
    const nearest = TYPES.filter(t => prof[t]).reduce(
      (a, b) => (dist(r.feature, b) < dist(r.feature, a) ? b : a),
    );
    if (nearest === r.truth) unconstrained++;
  }

  // Name the badge by its own hex/edge. Looking it up by truth type named the
  // wrong harbour whenever the miss was a generic — there are four of those.
  const misses = test
    .map((r, i) => (r.truth === got.types[i] ? null : `h${r.hex}e${r.edge} ${r.truth}->${got.types[i]}`))
    .filter(Boolean);
  console.log(`${hits === 9 ? 'OK ' : '   '}${held.padEnd(10)} ${hits}/9` +
    (misses.length ? '  ' + misses.join(' ') : ''));
}

const pct = n => `${n}/${total} (${((100 * n) / Math.max(total, 1)).toFixed(1)}%)`;
console.log(`\nWITH the composition constraint : ${pct(right)}`);
console.log(`WITHOUT it (nearest profile)    : ${pct(unconstrained)}`);
console.log('\nProbe reported 83/90 (92.2%) and 72/90 (80.0%).');

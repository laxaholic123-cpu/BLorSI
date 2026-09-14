/**
 * Which harbours should the review screen tell the player to check?
 *
 * Reported from a device: the screen "acted like all of the ports were
 * correct, but they were not". The reader computed a margin and never showed
 * it. Before choosing a replacement signal, this measures candidates against
 * the 90 real badges, leave-one-capture-out, the same way the accuracy number
 * was measured.
 *
 * A flag is worth showing when it lands on the harbours that are actually
 * wrong (7 of 90 here) without landing on so many right ones that the player
 * learns to ignore it -- the lesson the number-token banner just taught, where
 * five flags caught zero errors.
 *
 *   node tools/harbour_flag_audit.mjs
 *   (needs tools/harbour_patches.* and a fresh dist-portcheck bundle; see
 *    tools/harbour_type_check.mjs)
 */
import { readFileSync } from 'node:fs';
import { cardFeatures, FEATURE_NAMES, PORT_SLOTS }
  from '../artifacts/dice-tracker/dist-portcheck/harbourTypes.js';

const meta = JSON.parse(readFileSync('tools/harbour_patches.json', 'utf8'));
const raw = readFileSync('tools/harbour_patches.bin');
const S = meta.size;

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

const rows = meta.patches.map((m, i) => ({
  capture: m.capture, truth: m.truth, hex: m.hex, edge: m.edge,
  feature: cardFeatures(bufferFor(i)),
}));

const TYPES = ['generic', 'brick', 'lumber', 'grain', 'ore', 'wool'];
const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length / 2;
  return s.length % 2 ? s[Math.floor(h)] : (s[h - 1] + s[h]) / 2;
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** Every legal labelling of nine badges: four generic, one of each resource. */
function allLabellings() {
  const out = [];
  const resources = PORT_SLOTS.filter(t => t !== 'generic');
  const permute = (arr) => arr.length <= 1 ? [arr] :
    arr.flatMap((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [x, ...p]));
  const perms = permute(resources);
  for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++)
    for (let c = b + 1; c < 9; c++) for (let d = c + 1; d < 9; d++) {
      const gen = new Set([a, b, c, d]);
      const rest = [...Array(9).keys()].filter(i => !gen.has(i));
      for (const p of perms) {
        const lab = new Array(9).fill('generic');
        rest.forEach((idx, k) => { lab[idx] = p[k]; });
        out.push(lab);
      }
    }
  return out;
}
const LABELLINGS = allLabellings();

const captures = [...new Set(rows.map(r => r.capture))];
const perBadge = [];

for (const held of captures) {
  const train = rows.filter(r => r.capture !== held && r.feature);
  const test = rows.filter(r => r.capture === held);
  const prof = {};
  for (const t of TYPES) {
    const sub = train.filter(r => r.truth === t);
    prof[t] = FEATURE_NAMES.map((_n, k) => median(sub.map(r => r.feature[k])));
  }
  const scale = FEATURE_NAMES.map((_n, k) => {
    const col = train.map(r => r.feature[k]);
    return Math.max((quantile(col, 0.75) - quantile(col, 0.25)) / 1.35, 1e-3);
  });
  const dist = (v, t) => v ? Math.hypot(...v.map((x, k) => (x - prof[t][k]) / scale[k])) : 0;
  const cost = test.map(r => Object.fromEntries(TYPES.map(t => [t, dist(r.feature, t)])));

  const totals = LABELLINGS.map(lab => lab.reduce((s, t, i) => s + cost[i][t], 0));
  let bestIdx = 0;
  totals.forEach((v, i) => { if (v < totals[bestIdx]) bestIdx = i; });
  const best = LABELLINGS[bestIdx];

  test.forEach((r, i) => {
    // Regret: how much worse the best labelling is that changes THIS badge.
    let alt = Infinity;
    LABELLINGS.forEach((lab, j) => { if (lab[i] !== best[i] && totals[j] < alt) alt = totals[j]; });
    const nearest = TYPES.reduce((a, b) => (cost[i][b] < cost[i][a] ? b : a));
    perBadge.push({
      capture: held, hex: r.hex, edge: r.edge, truth: r.truth, got: best[i],
      wrong: best[i] !== r.truth,
      regret: alt - totals[bestIdx],
      forced: nearest !== best[i],
      noFeature: r.feature === null,
    });
  });
}

const wrong = perBadge.filter(b => b.wrong);
const score = (name, pick) => {
  const flagged = perBadge.filter(pick);
  const caught = flagged.filter(b => b.wrong).length;
  const boards = new Set(flagged.map(b => b.capture));
  const badBoards = new Set(wrong.map(b => b.capture));
  const boardsCovered = [...badBoards].filter(c => boards.has(c)).length;
  console.log(`${name.padEnd(28)} flags ${String(flagged.length).padStart(3)}  ` +
    `catches ${caught}/${wrong.length}  false ${flagged.length - caught}  ` +
    `bad boards covered ${boardsCovered}/${badBoards.size}  ` +
    `clean boards flagged ${[...boards].filter(c => !badBoards.has(c)).length}`);
};

console.log(`${perBadge.length} badges, ${wrong.length} wrong after the constraint\n`);
score('constraint moved it', b => b.forced);
score('no card features', b => b.noFeature);
for (const t of [0.5, 1, 1.5, 2, 3, 4]) score(`regret < ${t}`, b => b.regret < t);
for (const t of [1, 2, 3]) score(`moved OR regret < ${t}`, b => b.forced || b.regret < t);

console.log('\nthe wrong ones:');
for (const b of wrong) {
  console.log(`  ${b.capture.padEnd(10)} h${b.hex}e${b.edge} ${b.truth}->${b.got}  ` +
    `regret ${b.regret.toFixed(2)}  moved ${b.forced}`);
}
const rightRegrets = perBadge.filter(b => !b.wrong).map(b => b.regret).sort((a, b) => a - b);
console.log(`\nregret of CORRECT badges: min ${rightRegrets[0].toFixed(2)}, ` +
  `10th pct ${rightRegrets[Math.floor(rightRegrets.length * 0.1)].toFixed(2)}, ` +
  `median ${rightRegrets[Math.floor(rightRegrets.length / 2)].toFixed(2)}`);

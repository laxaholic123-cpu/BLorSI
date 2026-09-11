/**
 * When the review screen says "3 to check", how many are actually wrong?
 *
 * Reported from a device: the reader flagged 3 hexes to check on a board it had
 * read 19/19 correctly. That is a claim with a number behind it, so this
 * measures the number instead of adjusting the wording and hoping.
 *
 * `confidence: 'low'` does NOT mean "probably wrong". `reconcileBoard` sets it
 * on any hex the constraint solver had to MOVE — and moving hexes is the whole
 * point of the solver, which is usually right when it does. So the flag as
 * built means "the reader and the solver disagreed here", and the question is
 * how much that overlaps with "this is wrong".
 *
 * Four outcomes per hex, and only one of them justifies a tap:
 *
 *   flagged + wrong    the flag earned its keep
 *   flagged + right    a false alarm — the player checks and changes nothing
 *   unflagged + wrong  the dangerous one: silently wrong, no prompt
 *   unflagged + right  the happy path
 *
 * SCOPE: the NUMBER half only. Crops in tools/crops.bin are token faces, so
 * resources are fed in already correct and the desert sits where the truth
 * says. That isolates the token path, which is what the report was about, and
 * it means the resource solver contributes no flags here either way.
 *
 *   python tools/dump_crops.py        (once, to regenerate crops.bin)
 *   cd artifacts/dice-tracker && npx esbuild services/vision/digitSample.ts \
 *     services/vision/digitShape.ts services/boardConstraints.ts \
 *     --bundle --splitting --format=esm --outdir=dist-portcheck --alias:@=.
 *   node tools/confidence_audit.mjs
 */
import { readFileSync } from 'node:fs';
import { sampleDigit } from '../artifacts/dice-tracker/dist-portcheck/digitSample.js';
import { matchDigit, resolveSixNine, isTrustworthy }
  from '../artifacts/dice-tracker/dist-portcheck/digitShape.js';
import { reconcileBoard } from '../artifacts/dice-tracker/dist-portcheck/boardConstraints.js';

const meta = JSON.parse(readFileSync('tools/crops.json', 'utf8'));
const raw = readFileSync('tools/crops.bin');

/** The board every capture shows. null is the desert. */
const TRUTH = [4, 11, 6, 5, 10, 11, 12, 4, 5, null, 8, 10, 2, 9, 3, 3, 6, 8, 9];

/**
 * A legal resource layout with the desert where the truth puts it.
 *
 * Resources are not in the crops, and the token assignment only cares about
 * WHICH hex is the desert — that is the one that takes no token. Feeding a
 * correct composition means the resource pass makes no changes and therefore
 * raises no flags, leaving the token flags on their own.
 */
const RESOURCES = (() => {
  const bag = [
    ...Array(4).fill('lumber'), ...Array(4).fill('wool'), ...Array(4).fill('grain'),
    ...Array(3).fill('brick'), ...Array(3).fill('ore'),
  ];
  return TRUTH.map(t => (t === null ? 'desert' : bag.pop()));
})();

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
for (const entry of meta) {
  const s = sampleDigit(bufferFor(entry), 0, 0, entry.size);
  if (!s) continue;
  if (!byPhoto.has(entry.photo)) byPhoto.set(entry.photo, []);
  byPhoto.get(entry.photo).push({ ...entry, sample: s });
}

let flagWrong = 0, flagRight = 0, quietWrong = 0, quietRight = 0;
const perBoard = [];
const declined = [];
const overruled = [];

for (const [held, items] of byPhoto) {
  // Leave-one-photo-out, so a template never matches itself.
  const library = [];
  for (const [other, rows] of byPhoto) {
    if (other === held) continue;
    for (const r of rows) library.push({ value: r.value, bits: r.sample.bits });
  }

  // What the reader alone says, before any constraint is applied.
  const readNumber = new Map();
  for (const r of items) {
    const m = matchDigit(r.sample.bits, library);
    const value = m ? resolveSixNine(m.value, r.sample.inkIsRed, r.sample.pipsSuggest) : null;
    readNumber.set(r.hex, value !== null && isTrustworthy(m) ? value : null);
  }

  const hexes = TRUTH.map((_t, i) => ({
    index: i,
    resource: RESOURCES[i],
    number: RESOURCES[i] === 'desert' ? null : (readNumber.get(i) ?? null),
    // 'high' when the reader stood behind it, 'low' when it declined. This is
    // the input confidence; reconcileBoard overwrites it for hexes it moves.
    confidence: readNumber.get(i) == null ? 'low' : 'high',
  }));

  const { hexes: final, changes } = reconcileBoard(hexes);

  /*
    WHY was each flag raised? Two very different reasons share one value:

      declined  the reader had no opinion, the solver filled it by elimination.
                This one MUST stay visible — folding it into "agreed" was a
                real bug once, and every declined token got stamped confident.
      overruled the reader gave a confident answer and the solver moved it.

    A fix that treats them the same would either re-hide the declines or keep
    nagging about repairs that were right.
  */
  for (const c of changes) {
    if (c.field !== 'number') continue;
    const wasDeclined = readNumber.get(c.hexIndex) == null;
    (wasDeclined ? declined : overruled).push(
      `${held} hex${c.hexIndex}: ${wasDeclined ? 'no read' : c.from} -> ${c.to}` +
      `${c.to === TRUTH[c.hexIndex] ? '' : '  WRONG'}`,
    );
  }

  let bFlagWrong = 0, bFlagRight = 0, bQuietWrong = 0, bQuietRight = 0;
  for (let i = 0; i < 19; i++) {
    if (TRUTH[i] === null) continue; // desert carries no token
    const correct = final[i].number === TRUTH[i];
    const flagged = final[i].confidence === 'low';
    if (flagged && !correct) { flagWrong++; bFlagWrong++; }
    else if (flagged && correct) { flagRight++; bFlagRight++; }
    else if (!flagged && !correct) { quietWrong++; bQuietWrong++; }
    else { quietRight++; bQuietRight++; }
  }
  const right = bFlagRight + bQuietRight;
  perBoard.push(
    `${held.padEnd(10)} board ${right}/18 correct, ` +
    `${(bFlagRight + bFlagWrong).toString().padStart(2)} flagged ` +
    `(${bFlagWrong} of them actually wrong)` +
    (bQuietWrong ? `  ** ${bQuietWrong} WRONG AND UNFLAGGED **` : ''),
  );
}

console.log(perBoard.join('\n'));

const flagged = flagWrong + flagRight;
const wrong = flagWrong + quietWrong;
const total = flagWrong + flagRight + quietWrong + quietRight;
const pc = (a, b) => (b === 0 ? '--' : `${((100 * a) / b).toFixed(1)}%`);

console.log(`\n${total} tokens across ${byPhoto.size} captures`);
console.log(`final board correct        ${total - wrong}/${total} (${pc(total - wrong, total)})`);
console.log(`flagged "to check"         ${flagged}`);
console.log(`  of those, actually wrong ${flagWrong}  -> flag precision ${pc(flagWrong, flagged)}`);
console.log(`  of those, already right  ${flagRight}  <- taps that change nothing`);
console.log(`wrong but NOT flagged      ${quietWrong}  (the dangerous case)`);
console.log(`\nrecall: ${pc(flagWrong, wrong)} of the genuinely wrong tokens got flagged`);

console.log('');
console.log('WHY each flag was raised:');
console.log('  reader DECLINED, solver filled it   ' + declined.length);
for (const d of declined) console.log('    ' + d);
console.log('  reader was confident, solver moved  ' + overruled.length);
for (const o of overruled) console.log('    ' + o);

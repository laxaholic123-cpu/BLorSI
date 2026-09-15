/**
 * Reading numbers in chunks must give EXACTLY the evidence a full read gives.
 *
 * The capture screen now reads tiles first and numbers a few hexes at a time,
 * yielding between chunks so the board fills in on screen. That is only safe if
 * the chunked evidence is identical to one full readFrame call. Colour is
 * deterministic and each token is decoded from its own crop, so it should be;
 * this checks rather than assumes, on the seven real frames.
 *
 *   node tools/chunked_read_check.mjs
 */
import { readFileSync } from "node:fs";
import { readFrame } from "../artifacts/dice-tracker/dist-portcheck/readFrame.js";
import { balanceForBoard } from "../artifacts/dice-tracker/dist-portcheck/whiteBalance.js";

const meta = JSON.parse(readFileSync("tools/frames.json", "utf8"));
const raw = readFileSync("tools/frames.bin");
const CHUNK = 6;

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

let identical = 0;
let fullMs = 0, chunkMs = 0;
for (const m of meta) {
  const c = m.corners.map(([x, y]) => ({ x, y }));
  const bal = balanceForBoard(frame(m), c);

  let t = performance.now();
  const full = readFrame(bal, c).evidence;
  fullMs += performance.now() - t;

  t = performance.now();
  const shot = readFrame(bal, c, { decodeTokensFor: [] }).evidence.map(e => ({ ...e }));
  const wanted = shot.map((e, i) => i).filter(i => shot[i].hasToken !== false);
  for (let k = 0; k < wanted.length; k += CHUNK) {
    const chunk = wanted.slice(k, k + CHUNK);
    const part = readFrame(bal, c, { decodeTokensFor: chunk }).evidence;
    for (const i of chunk) shot[i] = { ...shot[i], tokenCost: part[i].tokenCost };
  }
  chunkMs += performance.now() - t;

  const same = JSON.stringify(full) === JSON.stringify(shot);
  if (same) identical++;
  else {
    const diff = full.map((e, i) => (JSON.stringify(e) === JSON.stringify(shot[i]) ? null : i)).filter(i => i !== null);
    console.log(`${m.name}: DIFFERS at hexes ${diff.join(",")}`);
  }
}
console.log(`identical evidence: ${identical}/${meta.length}`);
console.log(`full read ${(fullMs / meta.length).toFixed(0)}ms, chunked ${(chunkMs / meta.length).toFixed(0)}ms per board (desktop)`);

# Bad Luck or Skill Issue? — working notes

A dice tracker that tells you whether you were genuinely unlucky or just bad.
Offline-first Expo app, plus a small Express server that exists only for the AI
board-scan feature.

This file holds what a new session cannot derive from the code: environment
quirks, decisions that look wrong until explained, and what is genuinely
unverified. Read `BACKLOG.md` for current status.

---

## Environment — read this first

**Node is not on the Bash tool's PATH.** Prefix commands, or use PowerShell:

```
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:Path"
```

**Use `pnpm.cmd` and `eas.cmd`, not `pnpm` and `eas`.** The machine's execution
policy is `LocalMachine: Restricted`, which blocks the PowerShell `.ps1` shims
npm installs. The `.cmd` shims work. (Command Prompt has no such restriction.)

**Metro and builds want separate terminals.** `dev:device` occupies its terminal
until Ctrl+C.

### Commands that work

```
pnpm run typecheck                                       # all packages
pnpm --filter @workspace/dice-tracker exec jest --no-coverage
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/dice-tracker run dev:device      # Metro, LAN
pnpm --filter @workspace/dice-tracker run dev:tunnel      # any network, slower
pnpm --filter @workspace/api-server run dev               # port 3000
```

---

## Two rules learned the hard way

**1. `expo install <pkg>`, never `pnpm add <pkg>`, for anything with native code.**

Four packages had been added with plain `pnpm add` and resolved to `latest` from
an SDK that does not exist for this project — `expo-document-picker@57` against
an expected `~14`. The result was a development build that died during native
module registration, before any JS ran, with a Kotlin `ClassNotFoundException`.
Run `pnpm exec expo install --check` after touching dependencies.

**2. Expo Go does NOT work.** `react-native-keyboard-controller`, Skia and
expo-camera are all outside it. A development build is required.
`README.md`, `ARCHITECTURE.md` and `DECISIONS.md` contain older claims to the
contrary — they predate these dependencies.

### Deliberate version divergence

`expo install --check` reports jest 30 and @types/jest 30 as wrong, wanting 29.
**Leave them.** That recommendation is for `jest-expo`, which this project does
not use — tests are pure logic under ts-jest with the node environment.
`jest-environment-node` is pinned to `^30` because react-native pulls in a v29
copy that Jest 30 would otherwise resolve, which silently broke every suite.
There is a note in `package.json`.

---

## Layout

```
artifacts/dice-tracker/     Expo app (expo-router)
  app/                      screens
  services/                 all logic — pure, no React
    vision/                 on-device board reader
  types/models.ts           every shared type and constant
  __tests__/                ~660 tests, pure logic only
artifacts/api-server/       Express — one real route, board-scan AI
tools/                      Python research harnesses (see below)
```

`@/` maps to the dice-tracker root. Use it, never `../../`.

---

## Conventions

- **Roll and dev-card events are immutable.** Undo sets `deletedAt`; corrections
  set `correctionOfEventId`. Stats always derive from the live log.
- **Storage failures must never crash a game** — but they must not be silent
  either. Catch, then surface. `exportAllData` deliberately throws: a backup that
  fails quietly hands someone an empty file they only discover after wiping a
  phone.
- **Tests import no React Native.** That is why `pixelBuffer.ts` (pure) is split
  from `pixelSource.ts` (Skia): anything importing a native module cannot be
  tested. Keep that boundary.
- **Dark theme only** so far. Colours come from `useColors`.
- API server imports use `.js` extensions (ESM), even from `.ts` sources.

---

## The statistical stance

The app's whole claim is telling real luck from noise, so the bar is higher than
"looks about right".

**Relative, never absolute.** Fixed thresholds are not thresholds — they are
functions of how long you played. A ±15% production band is ~1.1σ over 40 rolls
and ~1.8σ over 100, so the app was most confident where evidence was weakest.
Verdicts now come from seeded Monte Carlo percentiles (`services/luckEngine.ts`),
and chart colouring is standardised by z-score.

This mistake recurred **three times** at different layers — verdicts, chart
colours, and token ink detection. If you are writing a constant to compare a
measurement against, stop and ask what it should be relative to.

**One pre-registered statistic, not many.** Testing eleven numbers at p<0.05
finds something ~43% of the time on fair dice. Per-number breakdowns are
descriptive only.

**Ports and dev cards are separate axes.** Ports affect trade, not production —
reported beside placement strength, never folded in. There is no honest exchange
rate between "pips" and "2:1 ore", and inventing one is the same error again.

---

## The board reader (`services/vision/`)

Reads a board on-device, no network. **19/19 tiles** on a reference board.

Three ideas, each measured rather than assumed:

- **Rank tiles against each other**, not against fixed colours. The composition
  is known exactly, so "which three are greyest" is a better question than "is
  this close to grey" — and it is invariant to lighting.
- **Texture as a second channel.** Forest is the roughest surface, sand the
  smoothest. Separates tiles that collide in colour. A coarse untuned prior
  scores the same as a tuned one, which is the evidence it is not overfitted.
- **The 18 token faces are a built-in light meter.** Same printed cream, spread
  across the board. Fitting a plane to them maps and flattens the illumination.
  They spanned a quarter of the lightness scale on one board — enough to turn a
  lit forest into a mountain.

**Tokens are found by their INK, not their shape or their pale face.** An earlier
version tested "bright and desaturated centre" and failed, because the desert is
bright and desaturated — the exact tile it existed to identify. The desert is not
merely pale, it is *blank*.

**Geometry is supplied by the capture guide, not inferred.** Three separate
attempts at automatic detection all failed and are recorded with their results in
`tools/detect_probe.py`, `tools/hex_detect_probe.py` and `tools/register.py`.
**Read those before trying a fourth.** Aiming a camera answers the question by
construction. The decisive finding: most photos people actually take are
close-ups that do not contain the whole board, so there is nothing to detect.

The Python harnesses under `tools/` are how every claim above was measured, using
photos of a real board. Prefer measuring to reasoning here — this area has
produced more confident-and-wrong conclusions than the rest of the repo combined.

---

## Current state

**Well covered:** dice tracking, stats, verdicts, storage and migrations, the
constraint solver, the vision pipeline's logic. ~660 tests, all pure.

**Never run on a device:** the capture screen, dev card entry, the port selector,
the quick-exposure tap change, the results percentile column. Every vision
measurement used hand-marked geometry on a single board — a perfect score on one
sample is exactly when to be suspicious.

**Known weak points:** glare is unsolved and no global filter helps (measured);
grey-vs-brown confusions were the last colour errors to fall; navigation has no
test coverage at all, which is how two dead-end routes shipped.

**Environment gaps:** `.env.local` (dice-tracker) and `.env` (api-server) are
gitignored and must be recreated — see the `.env.example` in each. The app's LAN
address is baked in at bundle time, so switching networks means editing
`.env.local` and restarting Metro.

---

## Working style that has served this repo

Measure before building. Three separate times a plausible approach was built out
before being tested, and failed; the fourth time the measurement came first and
the result held. Negative results are committed on purpose so nobody repeats
them.

When a test fails, check the fixture before the code. Roughly half the failures
here were tests encoding an old assumption — a board painted flat when the reader
needs texture, a token painted smaller than the area sampled.

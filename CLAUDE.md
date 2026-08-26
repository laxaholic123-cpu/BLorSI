### Why token reading failed, in the order the causes were found

Each of these was found by measuring, and each looked like the whole answer
until the next one appeared. Worth reading before touching the token path.

**1. Scenery counted as ink.** The crop is square, the token is a circle, so
~21% of it is the tile beneath. Measured: tokens read 0/30 on the three textured
terrains against 7/24 on the two smooth pale ones. The decoder was largely
counting trees. Fixed by thresholding and blob-counting inside the disc only.

**2. The face is neither centred nor as large as assumed.** Measured on a real
capture, it is about 64% of the assumed radius and sits up to half a radius off
centre, because tokens are dropped onto tiles by hand. So the decoder was
thresholding a square that is mostly TILE, taking that huge region as the
"glyph", and demoting the actual digits to pips — which is why glyph counting
sat at chance and every two-digit token failed. `locateBrightDisc` finds the
face and refuses rather than guessing when what it finds is not disc-like.
Measured: 1/14 to 4/14.

**3. The downscale was destroying the detail.** `TARGET_WIDTH` was 1400, giving
a 1536-wide buffer, a ~55px token face and ~4px pips — under what blob counting
can resolve, which is why pips were consistently UNDER-counted. The same photo
read at falling widths scored 4, 3, 1, 2 out of 14. Raised to 2400, which leaves
a typical phone photo untouched.

**4. Confidence was a lie.** `decodeToken` called a reading confident whenever
the glyph count matched, and glyph counting is at chance. One export came back
with all nineteen tiles confident and fourteen wrong. That is worse than no
signal, because `reconcileBoard` prices its assignment off it. A reading is now
trusted only when the face was actually located and the ink colour agrees.

**5. Matching examples instead of reading digits works, but only on the DIGIT.**
The first attempt matched the whole token face and scored at chance; that result
was wrong, and wrong for a findable reason. See below. The idea was good — the token is already located, there are ten possible answers,
and every one is printed identically on the same board under the same lamp, so
it is a matching problem, not a recognition problem. It was built (polar
sampling, so rotation becomes a cyclic shift) and measured, and it does not
separate the digits. See `tools/token_match_probe.py`; the implementation was
removed rather than left in the tree.

The decisive test is leave-one-out on ONE photo: eight values appear twice, so a
template harvested from one physical token reads the other. Same lamp, same
camera, different token at a different angle. That is the easiest possible
version of the task and a necessary condition. Results, against ~1.2/12 chance:

    binary agreement          2/12
    binary Jaccard / Dice     3/12
    grey-value NCC            3/12
    sampling radius 0.65-0.95 flat

Only "10" matched confidently. Changing the comparison is not the lever; three
different metrics land in the same place.

**The reason is that it was sampling the wrong thing** — see cause 6. The face
was located badly and a crescent of TILE sat inside every sample. Matching the
cleaned digit instead takes the same test from 3/12 to 6/12. Do not conclude
from the table above that matching cannot work; conclude that matching a
contaminated whole-face sample cannot.

**6. Locating the face by BRIGHTNESS is wrong, and this one is still live.** A
gold wheat field is as bright as a cream token. `locateBrightDisc` found 5 of 18
faces on one capture and 0 of 18 on another, then silently fell back to a
guessed centre and radius — so nearly every face has been sampled off-centre
this whole time, by up to a quarter of a radius. SATURATION separates them
completely: nothing on a Catan tile is both bright and grey except the token.
Swapping to it tightened the per-face ink fraction from 0.14-0.78 to 0.19-0.50,
which is what a cream disc with a dark digit should give.

That is a genuine fix to the SAMPLING and it is measured, but it was only ever
run in the probe — it did NOT rescue matching, and it has not been tried against
blob counting, which had the same mislocalisation. If the local path is ever
picked up again, start here.

**Do not trust an accuracy number without checking the crops contain tokens.**
The cross-photo run of the above first reported 3/18. That number was garbage:
the second photo's corners were stale, so every crop landed on bare tile, scored
against a truth array for a board that was not in the frame. Rendering the 18
crops as a contact sheet took one minute and showed it immediately.

**7. Blob counting was given a second chance with cause 6 fixed. It stays dead.**
Worth recording because the fix looked like it should have rescued it: face
location went from 5 of 18 to 16 of 18, and it made almost no difference.
Swept across disc radii 0.60-0.90 and rim-rejection reaches 0.85-0.99, the best
cell is 7/18 against a 6/18 baseline, and the surface is noisy with no
structure — the signature of a weak feature set, not a tuning problem. PIPS,
which every decode keys off first, never exceed 10 of 18. `tools/blob_relocate_probe.py`.

**8. The masks are the useful thing, and nobody had looked at them.** Rendering
the binary mask beside each crop showed the digits segment CLEANLY — 9, 5, 10,
11, 12, 8 all plainly legible. Blob counting throws that away by reducing a
readable digit to three integers. Two findings came straight off that picture:

- Every failure was the same shape, a white CRESCENT down one side. The tile is
  darker than the face, so any of it inside the sampled disc thresholds as ink,
  and being the largest blob it gets called the digit while the real digit is
  demoted to a pip. It enters from outside, so it touches the disc boundary;
  the digit and pips never do.
- The earlier matching result was measured on those contaminated samples.

**9. The crop had no padding, so it was CLIPPING the tokens.** Found by a human
looking at the contact sheet, not by any measurement here. The crop was sized at
exactly `TOKEN_RADIUS * scale`, and tokens are dropped on tiles by hand, so any
token sitting off-centre ran off the edge of its own crop — 8 of 18 on the
reference capture. It is also where the crescent in cause 8 comes from: a clipped
token pulls tile into the sampled disc. `CROP_PADDING = 1.45` makes every token
whole in every crop across all seven captures. **Render the crops and LOOK at
them** — this cost weeks and was visible the whole time.

**Matching the cleaned digit shape works, and is the path forward.** Centre and
scale on the DIGIT's own extent, not the face, so print size, camera distance and
face-centring all drop out. Measured LEAVE-ONE-PHOTO-OUT across seven captures of
the same board — library built from six, reading the seventh, seven times over,
so nothing is ever matched against an example of itself:

    89% correct overall (99/111)
    100% precision on what it ACCEPTS (95/95 at score >= 0.91)
    86% of all tokens auto-filled
    about 2 taps per board left for the player

**Every accepted error before ink disambiguation was 6-vs-9**, all six of them,
at margins from +0.000 to +0.014. That is not a defect to tune away: a 6 turned
180 degrees IS a 9, and rotation-invariant matching cannot separate them by
shape. Ink colour settles it completely and took precision from 93.7% to 100%.
The rotation invariance that makes this approach work is exactly what creates
the one ambiguity, and the fix for it already existed in
`ocrTokens.disambiguateWithInk`.

**The threshold is a plateau, not a knife-edge**, which is what makes it
trustworthy. Precision climbs smoothly — 92.5% at 0.80, 96% at 0.85, 97% at
0.88, 98% at 0.90 — then holds at 100% across 0.91, 0.92 and 0.94, trading only
coverage (86%, 85%, 81%). A threshold that only worked at one value would be a
coincidence.

**The score is honest, and that is the part that matters.** Cause 4 was
"confidence was a lie" — nineteen tiles confident, fourteen wrong. This one
declines rather than guessing, and a declined token costs a tap while a wrong one
is expensive and invisible. `tools/digit_match_probe.py`, corners and ground
truth in `tools/board_shots.py`.

**Shipped, and two things had to move out of its way.** `readToken` no longer
counts anything. OCR was demoted to a diagnostic: it used to overwrite every hex
it had an opinion about and stamp it confident, which was fine while nothing
else could read a token and is not fine next to a 100%-precise matcher measured
at 1 of 17 against it. And `clippedTokenHexes` now warns about framing, because
padding the crop makes the OTHER failure likelier — a board shot tight to the
edge has crops running off the photo, which the reader drops silently and which
is indistinguishable in the result from a token it could not read.

**Check a port against the photos, not against unit tests.** `tools/port_check.mjs`
runs the actual shipped modules over the actual captures and reproduced the
probe to within a point. A translation error here would not have failed a test;
it would have surfaced weeks later as "recognition is worse on the phone".

**A reader that declines needs a UI that shows it.** Missed entirely on the
first device run. `reconcileBoardFromEvidence` folded "the reader had no
opinion" into "the solver agreed" — `cheapestKey({})` returns null, and null
read as agreement — so every declined token was filled by the deck solver and
stamped confident. The whole value of 100% precision is that a refusal is
visible and costs a tap; invisible refusals turn it back into the old problem of
not knowing which numbers to trust. Confidence now has three cases: agreed,
overruled, no opinion.

The symptom was indirect and worth remembering: the player reported "it said
seven needed fixing but they were fine". Those seven were TERRAIN adjustments,
correct and unrelated; the genuinely unsure numbers were the ones NOT flagged.
A vague "needs your attention" that does not say which part of a hex is unsure
trains people to ignore it.

**The reported "6 vs 8 mix-up" was not a misread — nothing was read at all.**
Diagnosed from the capture the player saved (`HARD_CASE` in
`tools/board_shots.py`). All four RED tokens — the two 6s and the two 8s,
hexes 2/10/16/17 — returned NO shape. The deck solver then had to place two 6s
and two 8s across four hexes with zero evidence, and got two wrong. That is a
50/50 guess presenting as a recognition error, and it is why the symptom looked
like a shape collision when the shape was never sampled.

The mechanism: the sampled disc is sized at `1/CROP_PADDING` of the crop, which
is right only if the homography scale is exact, and it never is — corners are
tapped by hand. A few percent generous and the disc overruns the face onto
tile. Mid-green tile (luminance ~140) falls under the Otsu cut (~163) and
becomes a crescent of "ink". When the digit touches the crescent they merge
into one blob that reaches the disc boundary, rim rejection discards it, and
the token reads as nothing. Black-ink tokens survive because their digit
usually stays clear of the crescent.

**Five fixes tried, none shippable. Recorded so they are not retried:**

    measure the radius from face pixels   4-7/18   far worse; the face mask is
                                                   not a clean disc, ink is
                                                   excluded from it
    shrink the disc globally              worse at every value; 0.90 is optimal
    fill the face's holes                 7/126; wrong approach and my flood
                                                   fill leaked
    exclude coloured tile from the ink    recovers 2 of 4, but precision falls
                                          from 100% to 95% — a bad trade when a
                                          wrong number is expensive and a blank
                                          costs a tap
    the same, but only as a FALLBACK      precision preserved at 100%, recovers
                                          shapes, but every recovered shape
                                          scores under the accept threshold, so
                                          it adds no auto-fill at all

**The circle fit was then built properly, and it does not beat the assumption.**
`tools/circle_fit_probe.py` casts 64 rays from the saturation centroid, ends
each on a sustained run of non-face, and fits a circle algebraically with one
round of outlier rejection. Measured against the assumed radius:

    assumed radius        HARD 14/18   refs 111/126   100% precision, 86% cov
    fitted, global test   HARD 14/18   refs 104-107   98%  precision
    fitted, adaptive test HARD 15/18   refs 106-108   100% precision, 85% cov

Better on the one hard capture, worse on the seven references. Not shipped.

Two traps inside it, both worth knowing before anyone tries again:

- **Rays start INSIDE the numeral.** The digit sits at the token's centre, so a
  ray that ends on the first sustained non-face run ends on the digit and fits
  a circle to it — measured, a median radius of 0.33x the true one. A ray must
  cross the digit before its run can end.
- **A version that refuses often looks like a version that works.** Before that
  fix the guard rails rejected 106 of 126 fits, so the reader silently fell
  back to the assumed radius on 84% of tokens and the "fit" was only really
  applied to twenty. It scored BETTER that way than when fixed. Always count
  how often a fallback fires before believing a comparison.

The remaining obstacle is that the face predicate cannot cleanly separate the
token from the pale sandy TILE BORDERS, which are also bright and unsaturated.
Calibrating the predicate against the token's own face colour helps a little
and not enough.

**6 vs 8 is the pair with no side-signal**, which is why losing their shapes is
worse than losing any other token's.** Both are printed red, so ink says
nothing; both carry five pips, so pip direction says nothing. Shape alone
separates them. Hole counting looks like the answer and is not: on clean digit
masks a 6 shows exactly one loop every time (7/7) but an 8 shows two in only 5
of 9 — glare closes a loop — so applying it would turn well-read 8s into 6s.
It can CONFIRM an 8, never rule one out. Across the seven reference captures
6/8 separates cleanly (gaps 0.17-0.35, nothing under 0.02), but a real game
produced two 6/8 errors, so that margin does not hold everywhere and there is
no capture of the failure yet.

**Device run, 25 Aug 2026: 17/19 exact, 19/19 terrain, and 16/16 of the
high-confidence readings correct.** The two errors were hexes 10 and 16, a 6/8
swap, and BOTH were flagged low — so the player was pointed at exactly the
tiles that were wrong. That is the whole design working on hardware: precision
where it commits, and honest silence where it does not.

**The red-token failure is real, not a measurement artifact.** Settled by
`DEVICE_RUN` in `tools/board_shots.py`, which carries the corners the player
marked in the app rather than my by-eye estimates. Those corners reproduce the
device result exactly: 15 of 18 sampled, all 15 accepted and correct, hexes
10/16/17 declined. Rendering the masks shows why, and it is not about red ink:
every mask carries a tile crescent, and a token fails when its digit happens to
TOUCH the crescent, merging into one rim-touching blob that gets rejected. Hex
2 is also a red 6 and read fine at 0.973 — its digit sat clear of the crescent.

**THE CRESCENT WAS A SYMPTOM. The face predicate never matched the face.**
Found by rendering the pipeline stage by stage for a player who asked to see it,
then checking the one number nobody had checked: how much of each crop actually
passes the face test. Answer: **1-2.5%**. The printed cream measures 0.33-0.37
saturation across all eight captures — warm paper under warm light, not neutral
grey — and the cut was `sat < 0.30`. The face failed its own test on every
photo ever taken. `locateFaceBySaturation` was returning the centroid of
whatever stray pixels did pass, which on one token sat 95px from the token in a
323px crop. The "crescent" was simply a disc centred on nothing in particular.

It still read 15 of 18, which is exactly why it survived: the disc was large
enough to catch the digit anyway most of the time. A token failed only when the
misplacement happened to leave the digit touching the disc edge.

Moving the cut to 0.45 (tiles sit at 0.53 median, so they still fail):

    sampled     111/126 -> 126/126, and 18/18 on both the device run and HARD
    overall     89% -> 96%
    coverage    86% -> 94%
    precision   100% -> 100%

Every one of the eight "fixes" below was tuning the geometry of a disc that was
in the wrong place. **Before optimising a stage, verify its input predicate
actually fires.** This is the third time in this file that a silent
never-matches predicate has cost weeks — `locateBrightDisc` found 5 of 18 faces,
`decodeToken` called everything confident, and now this.

**Eight fixes for that crescent were measured before the real cause was found,
and all were worse than shipping nothing.** Measured radius, global disc shrink, hole filling, hue-
excluded ink, hue as a fallback, circle fit with a global predicate, circle fit
with an adaptive predicate, and removing a rim annulus before labelling. The
current sampler is a local optimum. Anyone attacking this again should start by
questioning the FRAME — the crop, the threshold, the rim-rejection rule as a
whole — rather than tuning inside it, because the inside has been swept.

**Two screens answering different questions with the same word.** The capture
screen said "5 tiles came out uncertain" and the next screen said "3 numbers to
check". Neither was wrong: the first counted `evidenceConfidence` below
threshold, which is about whether ANOTHER SHOT would help, and the second
counted solver disagreement, which is about what needs fixing. Nothing was
broken, which is what made it corrosive — the player cannot tell which number
to believe. The capture screen now counts what the review screen will flag and
mentions the thin-evidence count separately.

**THE TOKEN BAG FINISHES THE JOB. 180/180 tokens, 10/10 boards perfect.**
Measured leave-one-capture-out across ten captures of two layouts. The reader
alone gets 174/180 accepted at 100% precision; the six it declines are then
FORCED by the bag, because the deck is fixed — one 2, one 12, two of everything
else — so every committed number removes a possibility from the ones it did not.

This only works because at most ONE token is declined per board. One empty slot
leaves exactly one value, so nothing is guessed. That is why lowering the accept
threshold mattered more than the coverage number suggests: 94% -> 97% is what
keeps declines to one. The device run that swapped a 6 and an 8 had THREE
declines with {6,8,8} left over — the bag could not force that, so it guessed.

Coverage is therefore not a comfort metric. It is what makes the constraint
solver exact rather than probabilistic.

**Pip COUNT is still bad, and this is the interesting contrast with holes.**
Both were dismissed early through the broken face predicate, so both deserved
re-measuring. Only one recovered:

    hole count   198/200  (99%)   was "an 8 shows both loops 5 times in 9"
    pip count     58/144  (40%)   was "9 of 18, and that is its ceiling"

The pip ceiling was REAL, not a measurement artifact. And note pip DIRECTION
works at 98% while pip COUNT sits at 40% — direction needs only the centroid of
whichever pips were found, count needs every one of them exactly. When
re-testing an abandoned signal, ask which property of it you actually need.

**Dead code with live tests.** `tokenDecode.ts` and six binaryOps helpers —
`countHoles`, `splitGlyphsAndPips`, `filterNoise`, `locateBrightDisc`,
`fallbackDisc`, `maskToDisc` — have no callers outside their own module, and 55
tests still cover them. Passing tests on unused code are worse than plain dead
code: they make it look supported. `locateBrightDisc` is the specific hazard,
being the brightness-based face locator whose silent failure cost weeks.

**Caveat, and it is a real one.** All seven captures are of the SAME physical
board. This is validated across photos — different angles, distances, lighting
and glare — but NOT across Catan sets. A different printing may need its own
examples, which is the argument for a "teach it your board" step rather than a
library shipped in the app.

**Even with all four fixed, blob counting reads 9 of 18.** That is roughly its
ceiling: the pips are a few pixels across and no amount of tuning recovers them.
Hence OCR.

### The deck constraint helps less than it looks

Recorded because it is genuinely counter-intuitive and was measured twice.

`reconcileBoard` solves a Hungarian assignment with the deck enforced — one 2,
one 12, two of everything else. The obvious next step is to feed it graded
evidence instead of one guess per tile. **That is worse.** On the real capture it
scored 8/18 against 9/18 for the plain per-tile decode, and simulated across
accuracy levels it loses at every one, including 95%.

The reason is structural: forcing a complete permutation means a wrong tile can
only be fixed by moving a right one, and flat costs give the solver no basis for
choosing which to sacrifice. Pinning confident reads recovers the loss but does
not beat the raw reader.

The deck only pays when it **fills gaps** rather than overriding: +0.2 to +0.9
tiles, growing with the gap rate. The existing costs already encode that
preference ten to one, which is why calibrating confidence matters more than
reweighting the matrix. `tools/assignment_probe.py` keeps the experiment.

### Reading numbers as digits (`ocrTokens.ts`, `ocrSource.ts`)

`tokenDecode.ts` avoids OCR deliberately, and its reason is sound: counting
pips, glyphs and holes is rotation-invariant and OCR is not. But it needs small
features to survive thresholding and on real photos they do not.

expo-mlkit-ocr reads the whole photo once; each recognised number is mapped back
to a hex through the same homography the reader uses. One native call, and no
file writing — cropping 19 tokens would need `expo-file-system`, which is not
installed.

The two approaches complement rather than compete. **Ink colour resolves the one
ambiguity rotation leaves**: 6 and 8 are the only red tokens, so a red 6-or-9 is
a 6. And the deck can still fill what OCR misses.

Split to preserve the rule that tests import no React Native: geometry in
`ocrTokens.ts` (pure, tested), the native call in `ocrSource.ts`, mirroring
pixelBuffer/pixelSource. **Lazily required** — it is a native module, so a build
made before it was added simply falls back and says so rather than crashing.

### Read storage on focus, not on mount

Three separate instances of this in one session, so it is a rule now.

A screen reached with `router.push` stays mounted underneath. If another screen
writes something it reads, a mount-only effect never sees it. Ground truth
looked unset after being set; exposure entry would have kept a stale board and
tapped corners on numbers no longer on the table; saved layouts went missing
from the scan screen's list.

**Anything reading storage that another screen can write belongs in
`useFocusEffect`.**

### The harbour layout, and what settled it

Confirmed by research: the base game has **four 3:1 and five 2:1 harbours** (one
per resource). Several search results claim "5 generic and 4 specialized" — that
is wrong, and it recurs across SEO-farm sites. `PORT_TYPE_COUNTS` is right.

**Web research could not settle the positions.** BoardGameGeek returned 403, the
Catan wiki 402, CatanFusion a certificate error, and the sites that did answer
carried the harbour-count error. A photograph of a real board did settle it.

`STANDARD_PORT_LAYOUT` is now transcribed from a photographed 5th-edition base
game: clockwise from the 3:1 beside the ore-4 hex — 3:1, 2:1 brick, 2:1 lumber,
3:1, 2:1 grain, 2:1 ore, 3:1, 2:1 wool, 3:1.

**How the placeholder gave itself away.** Its spacing was right and it passed
every structural check, but its types ran generic/specific/generic/specific with
a single pair at the end — exactly the *minimum* number of same-type neighbours
an odd cycle permits. That evenness is the tell. A real frame reads G,S,S,G,S,S,
G,S,G, with three same-type pairs, because harbours suit the island rather than
a pattern. Structural plausibility is not evidence; it was the tidiest possible
arrangement, which is what a construction looks like and a transcription does not.

**What is confirmed, and what is not.** The anchor, the clockwise type order,
and the tile each harbour sits beside all came from the board owner — all nine
adjacencies were read back and confirmed. That rules out the large failure mode:
the ring cannot be rotated, and no harbour is beside the wrong tile.

What remains is one edge of slack per harbour. Each is pinned to a hex, but most
of those hexes have two or three coastal edges, and the 3-4 spacing that picks
between them was assumed rather than measured. Being one edge out along the
coast keeps one of a harbour's two settlement corners correct and swaps the
other — so the worst case is a single corner gaining or losing trade access.

This is deliberately left open. It cannot reach production, luck or verdicts,
because ports are a separate axis by design, and closing it needs a straight-down
photo rather than an angled one.

Still edition-specific: frames differ between printings, and there is **no port
editor in the app** despite `catanBoard.ts` once implying players could "edit
it". Ports feed `portAccess` only, which never enters production or luck, so a
mismatched frame misreports trade access and nothing else.

### Reading a board from a photo — a worked example

The same photo re-derived the whole board, and the technique is worth recording
because it is the vision pipeline's own logic done by hand:

- The photo was rotated 180° (tokens upside down). Reversing the read order put
  the desert on index 9, the centre — which is what the photo showed, so the
  rotation was self-verifying.
- **One hex was unreadable through glare.** Its token was recovered by
  elimination against the known bag: seventeen tokens visible, one 3 missing, so
  the washed-out tile is a 3; and by resource count it is fields. This is direct
  evidence for the two claims the pipeline rests on — glare is unsolved, and
  ranking against a known composition recovers what a threshold cannot.

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
    modes/                  the game mode boundary (adapter + registry)
    vision/                 on-device board reader
  types/models.ts           core types — mode-agnostic
  types/boardState.ts       BoardExposureEvent, BoardPosition
  types/modes/catan.ts      Catan types (re-exported from models.ts)
  __tests__/                748 tests, pure logic only
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

## Where this is going

**Catan is the current focus, not the product.** The intent is game modes for
several popular board games sharing one dice-and-luck spine — the next one is
expected to be another game with board state, not a pure dice game.

The boundary for that lives in `services/modes/`. `GameModeAdapter` is what
cross-mode code (career stats, luck, accolades) is allowed to know about a game:
its board numbers, their probabilities, a player's positions and blocked numbers
at a turn, and production reduced to actual-vs-expected. Catan's adapter is
thin — the logic stays in `services/catanStats.ts`.

The rule for what goes in the adapter: **if a second board game would answer the
question differently, it is an adapter method; if it would answer it the same
way, it belongs in the core and not in the boundary at all.**

Two things about it that look wrong until explained:

- **The adapter is not generic over its event type.** A registry of adapters
  with differing event types forces every consumer to carry a type parameter it
  cannot resolve, because the session's mode is only known at runtime. So the
  boundary speaks `BoardExposureEvent` and each mode narrows to its own event
  exactly once, in its own adapter (`asCatan` in `catanMode.ts`).
- **"Blocked" is a method, not a field.** `robberBlocked` stays on Catan's event
  because it is a name in storage on real devices, but blocking as a concept —
  a number you are exposed to but temporarily earn nothing from — is not
  Catan-specific. Ask `getBlockedNumbersAtTurn`, never read the flag.

`GameSessionSettings.catan*` flags are mode-scoped despite sitting on the core
session. They keep those names for the same reason: renaming them is a
migration, not a refactor.

**Two ways in, offered side by side — not a fallback chain.** Game setup forks
explicitly: take a photo, or enter the board by hand. Both are first-class and
the choice is the user's, made up front rather than arrived at by failure. The
fallback ordering lives *inside* the photo path only — the on-device reader
(`services/vision/`) runs first, the AI call backs it up when it fails. Manual
entry is not the floor you land on after two failures; it is a peer route
someone may simply prefer, and it must stay complete enough to play a whole game
with the camera switched off.

**Every player gets an accolade, not one winner a spotlight.** The share card
used to describe this as "Spotlight one player", which was the wrong shape and
has been reworded. Someone wins, but the interesting output is a *different*
accolade for each player at the table: who was starved on their own best number,
whose robber luck was absurd, who quietly played the best game nobody noticed.
Good and bad both qualify; the bar is interesting, not flattering. Luck and skill
are separate claims and must read as separate claims.

Accolades come in two tiers. Dice-only ones live in the core and work in any
game; mode-specific ones are supplied by the mode adapter. A new game gets the
dice accolades for free and adds its own.

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

**Accolades are descriptive, and have to be built that way.** "The weird thing
that happened this game" is multiple comparisons by construction: search across
players, numbers, turns and streaks and something always looks remarkable. This
is the same error as the fixed threshold and the eleven-number breakdown,
arriving through the front door as a feature request. The way out is not to drop
accolades — they are the point of the product — but to fix the candidate set in
advance and report each one's rarity against simulation, so "once in fifty games"
means the same thing in every game. Anything mined post hoc is entertainment and
must never be worded as evidence of luck or skill.

**Ports and dev cards are separate axes.** Ports affect trade, not production —
reported beside placement strength, never folded in. There is no honest exchange
rate between "pips" and "2:1 ore", and inventing one is the same error again.

---

## The board generator (`services/boardGenerator.ts`)

Builds a legal board so players can lay the tiles out from the screen. The one
setup path where the vision pipeline is not involved at all — a generated board
is known by construction, so there is nothing to read.

**Generate-and-score, not constraint-solve.** Several hundred candidates are
built and the best is kept. That always returns *something* (a board failing one
of five constraints beats an error), yields a score worth showing, and degrades
honestly when the settings are tighter than the tile bag allows.

**Selection score and reported score are deliberately different.** Candidate
ranking may only optimise the constraints the player switched on; `measureBoard`
always reports everything. This is not fussiness — measuring caught the bug.
With one shared score, "completely random" mode produced **0.03 adjacent red
pairs per board**, because the search was still quietly picking the most
balanced of 200 random boards and labelling it random. After the split it
measures 1.27. The test that pins this is in `boardGenerator.test.ts` and says
so.

**Balance and chaos are constructed indices, not measurements.** The penalty
weights are declared as a named constant so they can be argued with, and every
raw count is shown beside the score so nobody has to trust the weighting. There
is no experiment that makes an adjacent red pair "worth" 12 points.

**The 11-pip intersection cap matters more here than in a generic generator.**
A settlement on a 12-pip corner out-produces one on a 9-pip corner every game,
forever. Generating boards with runaway corners would undercut the app's own
central claim, which is telling luck apart from play.

### Settlement corners (`getAllIntersections`)

Exposure entry picks settlements off a generated board, deriving each one's
numbers from the hexes meeting at the tapped corner and its port from the
harbour serving that corner. Two geometry bugs surfaced here, both silent, both
caught only by testing the mapping from several directions.

**Corner identity is positional, never the set of touching hexes.** The obvious
id — sorted hex indices, `"0-3-4"` — is unique only for the 24 interior corners.
On the coast it collapses: hex 0 has three outer vertices touching nothing else,
so all three become `"0"`, and the two ends of the 0/1 border both become
`"0-1"`. That gives 48 ids for 54 corners. Nothing throws — two players on
different shore corners are told the spot is taken, and their exposure quietly
merges. Ids are now `"4v2"`: the lowest hex touching the corner, and the vertex
on it.

**Never key geometry on `toFixed`.** The corner positions are irrational sums
that reach zero only within rounding error, and the error is signed — the hex to
a corner's left gives +1e-16, the hex to its right −1e-16. `toFixed(3)` renders
those as `"0.000"` and `"-0.000"`, so one corner became two and the same board
had 60 corners. Keys are integer thousandths now; integers have no negative zero.

Both are the house failure mode: not a crash, but production credited to a
player who never had it, with every luck figure downstream inheriting it.

**Corner hit targets are 16 units, not the 7 the dot shows.** An invisible
circle sits on top of each dot, drawn last so it wins the tap. Neighbouring
corners are exactly HEX_R (40) apart, so 16 is the practical ceiling before two
targets overlap — about 28dp on a phone. Short of the 48dp guideline, but the
board's own geometry caps it: corners are ~35px apart at phone width.

**The distance rule is deliberately not enforced.** Settlements must be two
edges apart, and the app does not check it. Occupied corners are blocked because
that is unambiguous, but this is a recording tool, not a referee — and a
mis-tapped corner is visible in the settlement list, where the numbers are shown.

### Two React traps this screen hit

Both were found by trying to force an edge case, not by anything failing in
normal use — which is why they are written down rather than just fixed.

**Hooks must come before `catan-exposure-quick`'s `!activeSession` early
return.** Adding a `useMemo` after it meant the screen called ten hooks when the
session had not hydrated and twelve once it had. React throws "Rendered more
hooks than during the previous render" and the error boundary replaces the whole
screen. Normal navigation never showed it, because the session is already in
context by then; a cold start, an app restart mid-setup, or opening the route
directly all do. Any new hook here goes above that return.

**Deciding place-or-remove from a memo is a read-then-write race.** Reading
"is this corner taken" from derived state and then calling `setPlayerSetups` lets
two taps in one render cycle both see an empty corner and both append. The board
shows one mark while the player carries two settlements, so their exposure is
double-counted with nothing on screen to reveal it. The decision now happens
inside the updater, against `prev`.

### Handing a board between screens

`saveActiveBoard` / `loadActiveBoard` / `clearActiveBoard` in `storage.ts` carry
the generated board from the generator to exposure setup.

These three swallow their errors, which contradicts the rule that storage
failures must surface — and it is the one place that is right. This is a
convenience handoff, not a record: losing it costs a nicer input mode, and the
fallback is the number pad the player would have had anyway. `loadActiveBoard`
does reject a wrong-shaped board rather than repairing it, because a malformed
board is worse than no board — it would put wrong numbers on real settlements.

**Every non-generator path must call `clearActiveBoard`.** `new-game/catan.tsx`
does it for all destinations; only the generator sets one, on the way out. Miss
this and a scanned game silently inherits the previous game's generated numbers.

### What the research did and did not settle

Confirmed: the base game has **four 3:1 and five 2:1 harbours** (one per
resource). Several search results claim "5 generic and 4 specialized" — that is
simply wrong, and it recurs across SEO-farm sites. `PORT_TYPE_COUNTS` is right.

**Not settled: the actual fixed harbour positions.** BoardGameGeek returned 403,
the Catan wiki 402, CatanFusion a certificate error, and the sites that did
answer are the ones with the harbour-count error. `STANDARD_PORT_LAYOUT`'s own
disclaimer stands and the generator's "fixed positions" toggle inherits it —
the UI says so rather than implying an authority that was never established.
Reading nine positions off a physical box would settle it in two minutes; until
someone does, treat "traditional" as "the app's standard-style layout".

Structural facts that *are* established, if a future layout is derived: nine
harbours over thirty coastal edges spaced 3–4 apart (which is what stops two
sharing a settlement intersection), and near-alternating generic/specific — with
five and four around a nine-cycle, exactly one same-type adjacent pair is forced.

---

## The board reader (`services/vision/`)

Reads a board on-device, no network.

**Terrain works. Tokens do not.** On a clean overhead capture with the corners
marked, terrain reads **19/19** — the ranking approach genuinely holds up. Tokens
read 5/19 in the app and 9/18 at best in `tools/`. Those are two different
features behind one button, and it is worth keeping them apart when reasoning
about this area.

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
constraint solver, the mode boundary, the board generator, corner geometry, the
harbour layout. 712 tests, all pure.

The vision pipeline's *logic* is covered too, but coverage is not the issue
there — see the board reader section. It is internally consistent and wrong on
real input.

**Never run on a device:** the capture screen, dev card entry, the port selector,
player exposure setup, the results percentile column, the board generator screen,
and the harbour and corner rendering in `CatanHexGrid`. ("Exposure" here means a
player's board exposure — which numbers their settlements touch — not camera
exposure. The two sit one screen apart, and the collision has already caused one
misreading.) Every vision measurement used hand-marked geometry on a single
board — a perfect score on one sample is exactly when to be suspicious.

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

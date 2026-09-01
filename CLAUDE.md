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

**The pip decoder and its primitives are DELETED, not deprecated.**
`tokenDecode.ts` is gone, and with it `countHoles`, `splitGlyphsAndPips`,
`filterNoise`, `locateBrightDisc`, `fallbackDisc`, `maskToDisc` and
`threshold`. They had no callers left but 55 tests still covered them, which is
worse than plain dead code — passing tests make unused code look supported.

`locateBrightDisc` was the reason to delete rather than deprecate: it finds the
token face by BRIGHTNESS, it silently failed on bright tiles for weeks, and it
is exactly the kind of thing a future reader reaches for because the name
sounds right. binaryOps is now 187 lines from 300, and everything remaining has
a live caller: `otsuThreshold`, `otsuThresholdInDisc`, `connectedComponents`
and their types, all used by `digitSample`.

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

**A STATIC LAYOUT CANNOT BE RIGHT, AND MEASURING SHOWED WHY.**

The transcription is a real board, faithfully read, and it was still wrong for
both captures it was tested against. `tools/port_probe.py` locates the harbour
badges directly — they are cream and float in blue sea, which separates far more
cleanly than anything on the island — then snaps them to coastal edges:

    rotation of STANDARD_PORT_LAYOUT   mean distance from detected badges
      0 deg                              1.50 hex radii
     60 deg                              0.23
    120 deg                              1.50
    180 deg                              0.23
    240 deg                              1.50
    300 deg                              0.23

Every harbour is correct RELATIVE TO THE OTHERS. Only the anchoring is off, and
that is not a transcription error — **the frame stays assembled while the tiles
are reshuffled, and the app's hex numbering comes from whichever corner the
player taps first. Nothing ties one to the other.** The ring's rotation is
arbitrary from game to game, so no stored layout can be correct in general.

The three-way tie at 60/180/300 is expected: the position set has 3-fold
symmetry, so positions alone cannot pick between them. Types break the tie, and
a player can see the types.

Hence the fix is a ROTATION control rather than a nine-row editor
(`services/catanPorts.ts`, offered in the board-review screen): one tap turns
the whole ring, which is what the measurement says is actually wrong. The badge
sits 0.65 hex radii beyond its coastal edge midpoint, if anyone wires detection
up later.

**Reading a harbour's TYPE off colour does not work.** Three attempts, all in
`tools/port_probe.py` so none is retried: saturated pixels in a window measure
the SEA (the most saturated thing in frame, so every badge reads cyan); icon as
bright non-cream discards ore and the lumber log for being dark, which are the
two most distinctive icons; icon as non-cream inside the cream body's extent is
the best of the three and still overlaps — generic reaches 0.431 against
specific falling to 0.292, so two 3:1s outscore two 2:1s. The boat hull and dock
timbers overlap the badge and are larger than a resource icon. Three tuning
passes inside one frame is where this repo's own rule says stop.

Ports feed `portAccess` only, which never enters production or luck, so a
mismatched frame misreports trade access and nothing else. That containment is
why this survived unnoticed for so long.

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

**`run`, not `exec`, for anything that starts Metro.** `pnpm --filter … exec
expo start` does NOT set the working directory to the package — it runs from
the repo root, and Metro then roots itself there and resolves nothing. The
symptom is `Unable to resolve module ./index from …/badluck/.`, which reads
like a broken project and is only a wrong cwd. `run` executes the package
script with the package as cwd, which is why the commands above use it.

**Running the app on web, which is the only automated verification available
without a phone:**

```
cd artifacts/dice-tracker && npx expo start --web --port 8082
```

cwd is load-bearing twice over. Besides Metro's root, babel resolves
`babel-preset-expo` from the process cwd, and in this pnpm workspace that
package is linked under `artifacts/dice-tracker/node_modules` and NOT at the
repo root. Start it from the wrong place and bundling dies with
`Cannot find module 'babel-preset-expo'` — which looks like a broken install
and is not one. Passing the project root as an argument does not fix it;
only the cwd does.

The first web bundle takes 60-90 seconds. It is worth the wait: driving this
found a stuck-state bug on the critical path that no test caught.

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
  __tests__/                965 tests, pure logic only
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

**End-of-game accolades are COMPARATIVE, not rarity claims**, and that is what
makes them honest without a simulation behind every one. `assignAccolades`
ranks players against each other on twenty fixed axes and hands out one distinct
axis each via `hungarian`, stating the rank. "2nd of 4 on harbours" is true
whatever the dice did. Only `luck_percentile` touches the simulation, and
simulation-dependent axes are withheld entirely when it did not run.

**Live callouts are DESCRIPTIVE, and the reason is sequential testing.**
`services/liveCallouts.ts` says things during the game, and none of them may be
a claim about luck. Checking after every roll is not one test at p<0.05 but
eighty, so any live probability claim is wrong far more often than it looks.
"Three 8s in a row" is a fact and survives; "you're running cold" is a verdict
and belongs on the results screen, where the seeded Monte Carlo actually runs.

Four rules enforce it rather than convention: the candidate set is fixed in
`CALLOUT_CATALOGUE`; at most one callout per roll, by fixed priority; a kind
cannot repeat inside a cooldown; and **a test asserts no luck, probability or
skill word ever appears** in any emitted text. Rate on fair dice is measured,
not assumed — 9.4% of rolls, about one every eleven.

---

## The robber, and a bug that flattered everyone's bad luck

**Blocks never lifted.** Every 7 wrote a `robberBlockStarted` and nothing ever
wrote the matching end except a manual action buried in the development modal.
`getActiveRobberBlockedNumbers` unions every block it finds, so a player's
blocked set only ever GREW — after five sevens, five numbers were treated as
permanently robbed, for the rest of the game. Production was progressively
under-counted, silently, in the one direction that makes a player look
unluckier than they were. On the app whose entire claim is telling real bad
luck from imagined bad luck.

The robber cannot be in two places. `catanRobber.robberMoveEvents` returns the
ENDS for whatever was standing plus the STARTS for the new tile, in one array,
so a move cannot be half-applied.

**It blocked a NUMBER, not a TILE.** Two hexes can carry the same number, so
blocking "5" blocked both — a player whose second 5 was across the board lost
production the robber never touched. The prompt now shows the board and takes a
tile, and who is blocked is DERIVED from the six corners rather than asked for.

That in turn upgraded the stats. `blockedWeightForNumber` used to charge "the
largest single share" — a deliberate estimate, because capture only recorded
the number. With the hex recorded it is exact: charge the buildings standing on
that tile. Both modes still exist, because every block written before the change
has no hex, and the honest reading of those events is still the estimate.

**The robber also moves on a KNIGHT.** Only the 7 had a path, so a knight-driven
move could not be recorded at all and the block sat on whatever tile the last
seven put it on. There is a Robber pill on the build row now.

### Answering "is everything being captured?" with a measurement

`tools/capture_audit.mjs` recomputes the entire production ledger from the raw
event log — its own building state, its own robber bookkeeping — and compares
against `computePlayerProductionStats`. Deliberately does NOT reuse
`getBuildingStatesAtTurn` or `getActiveRobberBlockedNumbers`, because sharing
the helpers would make the comparison circular and prove nothing.

Result: **0 mismatches across 420 player-ledgers, 5 seeds.**

**My first run of it "found" 32 mismatches that were entirely my own error.**
The independent pass zeroed ALL production on a blocked number; the shipped code
charges one tile's worth, which is correct and documented. A disagreement
between two implementations says one is wrong, and it is worth about ninety
seconds to ask which before believing the new one. The second run found 18 more,
which turned out to be a silently failed esbuild leaving the harness measuring
stale code — check that the bundle actually rebuilt before trusting a delta.

## What the results screen leads with

**Mean and median roll are nearly irrelevant and used to be the headline.**
Nobody finishes a game wondering whether the mean was 7.1. They wonder why they
sat on 6 and 9 all night and never saw them. Worse, a table where everybody's
numbers landed can share a mean with one where nobody's did — so the summary
statistic is blind to the only question being asked.

`services/exposureReport.ts` answers it directly: the numbers each player holds,
how heavily, how often each actually came up, and par for a run of that length.
Every figure is a count or a difference of counts, and par is always relative to
the rolls actually made — "you should have seen six 8s" means nothing without
saying six out of how many.

**Nothing there is a luck claim**, and there is a test asserting the wording
never becomes one. Whether a gap is remarkable stays with the percentile, which
has the simulation behind it.

**Accolades carry their whole table now.** A rank with no way to see the other
places is a horoscope with a number in it — "4th of 4 for robber losses" invites
the obvious question of what the other three lost, and the ranking was already
computed to produce the badge. Tapping a card opens it.

## The statistical stance

The app's whole claim is telling real luck from noise, so the bar is higher than
"looks about right".

**Relative, never absolute.** Fixed thresholds are not thresholds — they are
functions of how long you played. A ±15% production band is ~1.1σ over 40 rolls
and ~1.8σ over 100, so the app was most confident where evidence was weakest.
Verdicts now come from seeded Monte Carlo percentiles (`services/luckEngine.ts`),
and chart colouring is standardised by z-score.

This mistake recurred **four times** at different layers — verdicts, chart
colours, token ink detection, and live callouts. If you are writing a constant
to compare a measurement against, stop and ask what it should be relative to.

The fourth is the clearest illustration, because it was caught by measuring
rather than by reasoning. `liveCallouts` flagged a number "back after a long
absence" at a flat 18 rolls. Eleven outcomes, wildly different frequencies: 18
rolls without a 6 is genuinely notable (expected gap 7.2) and 18 rolls without
a 2 is nothing at all (expected gap 36). Measured across 3600 fair rolls, that
one kind fired once every 16 rolls — more than every other kind combined.
Scaling the bar to each number's own expected gap (`2.5 / p`) took the whole
feature from 14.3% of rolls to 9.4% and left no kind dominating.

Nothing about the code looked wrong. It took counting how often each kind
fired, which is the same move that found `locateBrightDisc` and the face
predicate. **A threshold that is not relative to something is a bug you cannot
see by reading.**

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

**Hit targets were checked for overlap within their own family and not across
families, and that is where the bug was.** The corner radius (16) was justified
against other corners, the road radius (14) against other roads. Nobody
compared the two. An edge midpoint sits exactly 20 from each of its endpoints
and 16 + 14 = 30, so **a corner covers 25.1% of each touching road's hit disc**
— and corners are drawn last, so they win it.

That is not cosmetic, because of how react-native-svg hit-tests. Android's
`RenderableView.hitTest` walks children in REVERSE draw order and tests the
geometric fill REGION; it never looks at the fill colour, so `fill="transparent"`
is fully tappable and only `pointerEvents="none"` opts out. The web path renders
real DOM SVG, where `visiblePainted` hit-tests any fill that is not `none` —
`transparent` is a paint value, not `none`. Both platforms behave the same, so
this one would NOT have been caught by "it works on web".

The symptom it produced: during the opening road phase every offerable road
touches the settlement just placed, so the quarter of the road nearest that
settlement dispatched to the corner instead. `occupiedCorners` ignores the
active slot, so re-placing your own settlement returned no problem, fired the
**success** haptic and changed nothing. A positive haptic on a no-op is the
worst signature in this codebase — it reads as "the app got it" while the road
stays unplaced.

Fixed structurally rather than by tuning a radius: `CatanHexGrid` renders the
invisible corner target only when an `onIntersectionPress` handler exists, and
the placement screen passes `undefined` while a road is owed. An inert corner
now has nothing to hit-test with.

**Generalise this.** Two hit targets sized independently, each provably disjoint
from its own kind, is not evidence they are disjoint from each other. Count the
cross-family distances.

**Why `onLongPress` on an SVG shape fails, confirmed from the web side.** The
browser console says it outright: `Unknown event handler property onLongPress.
It will be ignored.` — and the same for every RN responder prop
(`onStartShouldSetResponder`, `onResponderGrant`, `onResponderRelease`, …).
react-native-svg passes them straight to the DOM element and React drops them,
so on web the ONLY surviving handler is `onClick`. That is a second platform
independently confirming the Android finding, and it means the `<Pressable>`
overlay used for hexes is not an Android workaround — it is the only way to get
a long-press on a shape anywhere.

**`app/touch-probe.tsx` settles which primitives work on a given build.** Seven
variants side by side with counters: transparent Circle (what corners and roads
use), zero-opacity fill, near-transparent paint, Rect, handler on a `<G>`, an RN
`<Pressable>` baseline, and `onLongPress` as the control. Reachable by URL only,
nothing links to it. Measured on web: transparent Circle FIRES, `<G>` fires,
`onLongPress` does not. Run it on a phone before debugging a screen — it turns
"tapping does nothing" into a named cause in under a minute, and that symptom
has cost this project three separate sessions.

**The distance rule IS enforced.** It was deliberately skipped for a long time
on the grounds that players will not let each other break it at a real table,
and that reasoning was wrong about the failure mode — the realistic error is a
mis-tap, not a rules dispute. `catanPlacement.settlementProblem` returns
`'too_close'`, and it turned out to be free rather than a chore: once placement
moved to CORNERS, an illegal corner is simply not offered.

### Three React traps this screen hit

All found by trying to force an edge case, not by anything failing in normal
use — which is why they are written down rather than just fixed. The third
arrived a week after the first two were fixed, in a DIFFERENT handler on the
same screen, which is the argument for treating this as a pattern rather than
three incidents.

**The read-then-write race, again, in the Next button.** `handleNextPlayer`
decided `isLastPlayer` from the render and then called
`setCurrentPlayerIdx(i => i + 1)`. Two taps inside one render cycle both decide
"not the last player" and both increment, so the index walks past the end and
the screen shows **"Player 5 of 4"** — a nonexistent player, a Next button that
names nobody and does nothing, and no way forward. Setup is on the critical path
of every game, so that is a stuck app.

The fix is the same shape as the double-placed settlement: make the repeat
IDEMPOTENT rather than trying to prevent it. `nextSetupPlayerIndex` returns a
clamped absolute index, so a second tap in the same tick sets the same value.
`handleStartGame` additionally takes a ref guard, because `isSaving` is state
and two synchronous calls both read it as false.

**Turn rotation wraps; setup must not.** `getNextPlayerIndex` is modulo, which
is right for whose turn it is and wrong for a one-pass setup. They are separate
functions now for that reason.

Reproduced and fixed on WEB before any device saw it, by firing four taps into
one tick — worth remembering that this class of bug is reachable from a browser
even though it presents as a touch problem.

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
does it for all destinations. Miss this and a game silently inherits the
previous game's numbers.

**The SCAN path never saved one, and that quietly disabled three features.**
Only the generator called `saveActiveBoard`, so for the main photo path there
was no board in storage — which meant the live board view, the results board and
the mid-game corner picker all silently did nothing for exactly the games most
likely to have a board. Found by wiring those features up and asking where the
board came from, not by anything failing. The scan screen now saves the
REVIEWED board (hexes plus the rotated harbour ring) on the way into placement.

### The board during play, and the split that made it awkward

`services/catanBoardState.ts` answers "what does the board look like right now",
which nothing did before: `getBuildingStatesAtTurn` is per-player and
`allRoads` is per-edge.

**A `locationId` is only sometimes a place.** Opening settlements placed by
tapping a corner carry a real intersection id (`4v2`); every road carries a real
edge id. But a settlement recorded mid-game through the number pad carried
`generateId()` — the player said which NUMBERS it touched and never said where
it was. So exposure was exact for the opening and self-reported for everything
after, and half the board could not be drawn.

Mid-game placement now offers the corner picker whenever a board is known, and
derives the numbers from it. The number pad stays for boards the app does not
have, and the two are mutually exclusive on screen — offering both invites
entering numbers that contradict the board.

**What cannot be drawn must be counted, not dropped.** `BoardSnapshot.unplaceable`
carries the per-player count of buildings with no position, and the board panel
prints it. A board that quietly omits two of your four settlements looks
complete while being wrong, which is the same failure as a reader that declines
invisibly — the whole value of showing the board is that it can be checked
against the table.

Ids are validated against the real geometry (`getAllIntersections`, `allEdges`)
rather than by pattern, because a pattern would accept `9v9`, which is not a
corner on any board.

### The harbour layout

See "The harbour layout, and what settled it" earlier in this file. It was
written up twice and the two copies disagreed: this one said the positions were
unsettled and that "reading nine positions off a physical box would settle it in
two minutes", which is precisely what someone then did. The transcription from a
photographed 5th-edition base game is the live account, and one open caveat
survives — the 3–4 edge spacing was assumed and cross-checked against the photo,
not measured.

---

## The board reader (`services/vision/`)

Reads a board on-device, no network.

**Both halves now work.** This section spent months saying "terrain works,
tokens do not" and that is no longer true — if you are reading it to decide
whether tokens need solving, they do not. Terrain reads **19/19** on a clean
overhead capture with the corners marked. Tokens are read by matching the
cleaned DIGIT shape (`digitSample.ts` + `digitShape.ts` against the bundled
`tokenLibrary.ts`), measured leave-one-photo-out:

    overall     96%          (was 89% before the saturation cut moved)
    precision   100% on what it accepts
    coverage    94%
    with the token bag applied:  180/180 tokens, 10/10 boards perfect

Confirmed on hardware, 25 Aug 2026: **17/19 exact, 19/19 terrain, and 16/16 of
the high-confidence readings correct.** The two errors were a 6/8 swap and both
were flagged low, so the player was pointed at exactly the tiles that were
wrong.

They are still two different features behind one button and worth keeping apart
when reasoning, but the old numbers in this paragraph (5/19 in the app, 9/18 in
`tools/`) belonged to **blob counting**, which is deleted. The full story of how
it got here — nine causes, each found by measuring — is at the top of this file.

Read the top section before touching the token path. The short version of its
lesson: the face-saturation predicate was cut at 0.30 when the printed cream
measures 0.33–0.37, so the face failed its own test on every photo ever taken,
and eight geometry "fixes" were measured against a disc centred on nothing.

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
harbour layout, opening placement and roads, board state and live callouts.
965 tests across 44 suites, all pure.

The vision pipeline's *logic* is covered too. Its recognition is now measured
rather than merely covered — see the board reader section.

**Run on a device and confirmed:** the capture screen and the whole read path
(25 Aug 2026 — 17/19 exact, 19/19 terrain). The corners the player marked in
the app are kept as `DEVICE_RUN` in `tools/board_shots.py`, which is what makes
that run reproducible offline.

**Never run on a device:** dev card entry, the port selector, player exposure
setup, the results percentile column, the board generator screen, the harbour
and corner rendering in `CatanHexGrid`, and everything in the "Untested on a
device" section of `BACKLOG.md` — the rebuilt opening placement, mid-game road
building, the accolade cards, the roll-pad fix and the corner-handle drag fix.
("Exposure" here means a player's board exposure — which numbers their
settlements touch — not camera exposure. The two sit one screen apart, and the
collision has already caused one misreading.)

Every vision measurement used hand-marked geometry, and all captures are of ONE
physical board — validated across photos, not across Catan sets. A perfect
score on one sample is exactly when to be suspicious.

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

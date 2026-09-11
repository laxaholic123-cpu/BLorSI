# Backlog audit

Re-derived from the original 31 tasks against the code as it stands on
`migrate-from-replit`. Where the handoff summary and the code disagreed, the
code won.

Caveat worth stating up front: this was audited from the task *summaries* in the
handoff document, not the original issue bodies. Anything marked "verify" below
may be more or less done than it looks.

---

## Done — close these

| # | Task | Evidence |
|---|---|---|
| 10 | Jest version mismatch | Was worse than described: all 12 suites failed to load. `react-native@0.81.5` pulls `jest-environment-node@29`, which Jest 30 resolved from the project root. Pinned `jest-environment-node@^30`. |
| 14 | Export/import for switching phones | Already existed in `storage.ts`; since hardened — export throws instead of silently returning `{}`, import validates event shapes and is additive. Surfaced on the home screen. |
| 24 | Unit tests for rollInput | Covered by `activeGameHandlers.test.ts`. |
| 26 / 38 | Typecheck gate in CI | `.github/workflows/ci.yml` gates typecheck, both test suites, and the api-server build. |
| 44 | Resource tally so players can catch AI miscounts | Superseded by something better: the constraint solver *repairs* the miscount rather than displaying a tally, and lists what it changed. |
| 55 | Regressions in production luck / heat-map colouring | Both covered now: production luck by `catanProductionWeights` / `luckEngine` / `verdictSimulation`, heat-map colouring by `chartPalette.test.ts`. |
| 65 | Heat-map colour consistency | Fixed by extracting `constants/chartPalette.ts`. Both charts now share one palette AND one hot/cold classifier, so they cannot drift again. Also fixed a second bug found on the way: the frequency chart called a number "hot" at half a roll above expected, which on eleven outcomes coloured nearly everything. |
| 45 | Correction panel saving a productive hex with no number | Done is now disabled, with a hint, unless the hex is desert or has a token. |
| 56 | Regressions in career stat aggregation | `careerStats.test.ts` covers it. One fixture was wrong (a settlement on number 7) and has been fixed. |

## Addressed by the storage rework — verify and close

| # | Task | What changed |
|---|---|---|
| 33 | Robber-tracking data loss when storage fails on a 7 | Robber block writes go through the same re-throwing path as rolls; callers surface failure. Worth a deliberate test with storage forced to fail. |
| 34 | Roll data consistency if a save fails mid-game | `persistRollEvents` re-throws and `active-catan` rolls back the in-memory state on failure. |
| 35 | Player rename silently dropped when storage unavailable | Same re-throwing path via `updateSession`. |
| 61 | Stuck on results if `endSession` fails silently | Fully closed. Navigation always happened, so nobody was trapped; the residual silence is now fixed too — `confirmEndGame` takes an `onPersistError` callback and both game screens surface it, so an unsaved game is explained rather than reappearing as active with no warning. |

## Still open, in the order I'd take them

**High — these change what a user sees**

- **#15 Light theme.** Largest untouched user-facing item. Mostly mechanical now that everything reads from `useColors`.
- **#57 / #63 Number performance as a bar chart on the verdict card.** `RollFrequencyChart` is on results but **not** on `share-card.tsx` — the share card is the growth loop and has no chart.
- **#58 Share career stats and head-to-head.** `shareCard.ts` has no career path at all.
- **#59 / #62 Share card correctness on device.** Untouched, and now genuinely blocked on a device pass.

**Medium — correctness and flow**

- **#13 / #54 Robber blocks on the game screen.** #13 looks done (`activeRobberBlocks` is computed and rendered). #54 (lift a block without leaving the screen) is **not** — `robberBlockEnded` only exists in `catan-development.tsx`.
- **#47 Skip the board re-scan when only fixing a settlement.**
- **#12 Skip re-running exposure setup on resume mid-session.**
- **#39 Duplicating an old custom-mode game.** `normalizeSession` maps the legacy `custom` mode, so this may already be fixed — verify.
- **#30 Getting stuck when the app restarts mid-game on web.**

**Deferred — worth doing on a quiet day**

- ~~**Settlement distance rule in board-mode exposure entry.**~~ Done. Enforced
  in `catanPlacement.settlementProblem`, and it turned out to be free rather
  than a chore: once placement moved to CORNERS, an illegal corner is simply
  not offered. The reasoning that deferred it was right about tables and wrong
  about the failure — the realistic error is a mis-tap, not a rules dispute.

**Untested on a device — the current risk, in one place**

Everything below was built and verified offline (typecheck, 965 tests) and has
never run on hardware. Grouped because they are one testing session, not five:

- The rebuilt opening placement: corner taps, road taps, the turn strip,
  long-press to clear one turn, colour picking.
- Mid-game road building from the new Road pill.
- Accolade cards on the results screen.
- **The mid-game corner picker** (`catan-development`) — another SVG hit
  target, and the one that most needs a real finger.
- **The board panel** on the active screen and on results.
- **The live callout line**, which sits between the scroll area and the roll
  pad. It is one line of fixed height for exactly that reason; check the pad
  still has its two rows.
- **The harbour ring** in board review — now detected positions plus a
  tap-to-correct type picker, so there are new Pressable targets out in the
  sea that have never met a finger.
- The roll-pad fix — `numGrid` had `flex: 1` inside a wrapper with none, which
  collapsed ten buttons to one row. Reported as "most of the numbers cannot be
  tapped" and never confirmed fixed.
- The corner-handle drag fix (ScrollView stealing the gesture, and PanResponders
  being rebuilt mid-drag by an `onLayout` that allocated a new object every pass).

The SVG hit targets are the ones to watch. Android touch dispatch has broken
this project three times — long-press correction, corner handles, and the roll
pad — and every one of them worked on web.

**One of them was found and fixed BEFORE the device session, by counting.**
The corner hit radius (16) had been checked against other corners and the road
radius (14) against other roads; nobody compared the two families. An edge
midpoint sits exactly 20 from each endpoint and 16 + 14 = 30, so **a corner
covers 25.1% of each touching road's hit disc**, and corners are drawn last so
they win it. During the opening road phase every offerable road touches the
settlement just placed, so the quarter of the road nearest it dispatched to the
corner instead — and because `occupiedCorners` ignores the active slot, that
re-placed the same settlement, returned no problem, fired the **success** haptic
and changed nothing.

This one would NOT have been caught by the usual "works on web, broken on
Android" split: Android's `RenderableView.hitTest` walks children in reverse
draw order and tests the geometric fill region (so `fill="transparent"` is fully
tappable, and only `pointerEvents="none"` opts out), and the web path renders
real DOM SVG where `visiblePainted` hit-tests any fill that is not `none`. Both
platforms behaved identically and both were wrong.

Fixed structurally, not by tuning a radius: `CatanHexGrid` renders the invisible
corner target only when an `onIntersectionPress` handler exists, and the
placement screen passes `undefined` while a road is owed. Mid-game road building
was checked and is unaffected — that screen renders no corners at all.

**Still to prove on hardware:** whether a transparent SVG `<Circle>` receives
taps on Android in this build at all. Corners and roads are the only interactive
elements in the app with no RN `<Pressable>` fallback (hexes have one), so they
fail together if it does not. That is the single question the device session
should answer first.

**Lower**

- **#22 Skip the action-picker from the game screen.** Looks done — direct `?action=add_settlement` / `?action=upgrade_city` links exist.
- **#11 Live Catan production during the game.** Looks done — `CatanProductionLeaderboard` is on the active screen.
- **#43 Escape the "Reading the board…" spinner.** Client has cancel affordances; the server now enforces a 45s timeout and returns a usable 504.
- **#16 Bluetooth dice reader.** Unstarted, large, and needs a dev build to even prototype.
- **#40 Board scan on a real Android device.** Blocked on the provider decision and a device pass.

---

## Not in the original 31, but now on the critical path

0. **First real-game test, 2026-08-20 — results.** Three findings, two already
   fixed.

   - **Board scan is not usable yet.** ~8/19 tiles, some wrong ones marked
     confident. See item 7; blocked on a saved failing capture.
   - ~~**Long-press to correct did nothing.**~~ Fixed. `react-native-svg` on
     Android fires `onPress` on shapes but not reliably `onLongPress`, so the
     correction affordance shipped looking right and was inert. Hex touches now
     go through RN `<Pressable>`s laid over the hex centres. Geometry verified
     arithmetically; the touch behaviour is unverified until someone long-presses
     a hex on a phone.
   - ~~**Generator appeared to invent numbers.**~~ Fixed, and it was a display
     bug only — 200 generated boards contain zero invalid tokens. Raw 0-18 array
     indices were being shown as "Hex 18" and "hexes 0, 3, 4", which read as
     tokens that do not exist.

   Not exercised this session: exposure entry by tapping corners, and the
   generator-to-game flow past setup. Those remain unverified on a device.

0. **Second real-game session, 2026-08-22 — results.**

   - **Corner marking works and geometry is no longer the problem.** Terrain
     went 4/19 to 17/19 on the same photo, and 19/19 on a good one. The
     experiment was clean because Compare reads one photo with both corner sets.
   - **Tokens diagnosed properly at last**, by looking at the crops rather than
     the scores. Four causes, all fixed, all recorded in `CLAUDE.md`.
   - **ML Kit OCR added** (`expo-mlkit-ocr`), lazily required so the previous
     build keeps working. Needs a new development build to take effect.
   - **A negative result worth keeping:** enriching the deck-constraint cost
     matrix makes things WORSE, at every accuracy level. Do not build it. See
     `tools/assignment_probe.py`.
   - **Three stale-read bugs** from screens reading storage on mount while
     another screen writes it. Rule recorded: use `useFocusEffect`.

   Still unexercised on a device: corner tapping for exposure entry, and the
   generator-to-game flow past setup.

1. **Device verification.** Eleven commits of UI change, none run on a phone,
   spanning six screens: dev card entry, port selector, player exposure setup,
   board-review corrections, results percentile column, home screen backup link.
   That range runs from `766b1d0` (2nd-newest UI commit) back to `f285a68`
   (11th) — effectively all UI work since the Replit migration. It excludes the
   capture and scan screens (`466f40c`, `0acf582`, `d7175d3`), which are also
   unrun and are the highest-risk of the lot: newest, plus Skia and the camera.
   All typecheck-clean and logic-tested; none exercised where this project's
   bugs historically live (Android SVG touch dispatch), and navigation has no
   test coverage at all.

   Caveat: `catan-exposure-quick.tsx` also has pre-migration history
   (`875219d`, `14b4f9f`). Whether that older code was ever exercised on a
   device back on Replit is unknown, so `f285a68` is the bound of what is
   *clearly* unverified, not necessarily of what is untested.

2. ~~**Crash reporting.**~~ Done — `services/crashReporting.ts`, wired into the root layout. Inert without `EXPO_PUBLIC_SENTRY_DSN`, so it collects nothing until a DSN is set. Still worth reporting the storage failures that are deliberately swallowed: those are invisible by design, which is exactly why they need a voice.
3. ~~**Harbour layout unverified.**~~ Closed — `STANDARD_PORT_LAYOUT` is now
    transcribed from a photographed physical board rather than guessed, and
    pinned by `portLayout.test.ts`. The old placeholder was structurally
    flawless and still wrong: its types were the tidiest arrangement an odd
    cycle allows, which is what a construction looks like. Remaining caveat —
    the 3-4 edge spacing was assumed and cross-checked against the photo five
    times, not measured, so that is where to look if a board disagrees. Frames
    also differ between editions. (The "no port editor" caveat is closed: the
    review screen now has one, reached by tapping a harbour on the map.)

4. **Board scan provider decision.** Model and base URL are configuration now, but nothing works until a key and a reachable model are chosen. `EXPO_PUBLIC_DOMAIN` also needs repointing off the Replit domain.
5. ~~**`expo-av` is deprecated.**~~ Done — migrated to `expo-audio`. The new player
   is synchronous to create and control, so the old async cache-and-await dance is
   gone. Done on a quiet day rather than under SDK 55 upgrade pressure, which was
   the point.

6. **Always use `expo install`, never `pnpm add`, for anything with native code.**
   Not a task, a rule — learned the hard way. Four packages (`expo-document-picker`,
   `expo-media-library`, `expo-sharing`, `react-native-view-shot`) had been added
   with plain `pnpm add`, so they resolved to `latest` from an SDK that does not
   exist for this project. The result was a development build that died during
   native module registration, before any JS ran. `expo install` picks the
   SDK-compatible version; `pnpm add` does not know the SDK exists.
   Run `pnpm exec expo install --check` after adding any dependency.

7. **Local board scanner.** Reads the board on-device, no network, no AI.

   **Recognition: 19/19 tiles** on a reference board, from three ideas that were
   each measured rather than assumed — rank tiles against each other instead of
   against fixed colours (invariant to lighting), texture as a second channel
   (forest is the roughest surface, sand the smoothest), and the 18 token faces
   as a built-in light meter (they spanned a quarter of the lightness scale on
   one board, enough to turn a lit forest into a mountain). Ablation: texture
   alone 17/19, texture plus the light map 19/19. A coarse texture prior with no
   tuned values scores the same, which is the evidence it is not fitted.

   Token presence is found by looking for INK rather than for the token's pale
   face — the desert is not merely pale, it is blank. That separates it by a 2x
   margin and is what anchors the whole board.

   **Geometry is supplied by the capture guide, not inferred.** Three distinct
   attempts at automatic detection all failed and are recorded in `tools/` so
   none is retried: radial profile of a segmented land mask, per-hex colour
   blobs, and optimisation-based registration. Aiming the camera answers the
   question by construction.

   **Validated on real device captures — and it split in two, then rejoined.**
   Terrain was solved first: **19/19** on a clean overhead capture with the
   corners marked. Tokens lagged badly — 5/19 in the app, 9/18 at best offline —
   through four causes found by measuring (scenery counted as ink, the face
   neither centred nor as large as assumed, the downscale destroying pip detail,
   and confidence claiming reliability it did not have). Even with all four
   fixed, blob counting topped out around half, because pips are a few pixels
   across on a phone photo of a whole board. **That approach is now deleted**;
   the numbers above are history, not current status. See the digit-matching
   result below and `CLAUDE.md` for the full order of causes.

   **OCR went in and failed too**, three ways: the whole photo, the cropped board
   at eight rotations, and one crop per token — 1 of 17 at best. It reads
   text-SHAPED things, and a serif digit on a cream circle with pips beneath it
   is not one. Detection is the blocker, not recognition.

   **Blob counting then got a fair second chance and stays dead.** The face
   locator was the suspect — it finds the token by BRIGHTNESS, and a gold wheat
   field is as bright as a cream token, so it was locating 5 of 18 faces and
   silently falling back to a guess. Locating by SATURATION takes that to 16 of
   18 and decoding barely moves: best 7/18 against 6/18, across a full sweep of
   disc radii and rim rejection. Pips never exceed 10 of 18. Closed.

   **Solved by matching the cleaned DIGIT SHAPE against examples of it.**
   Leave-one-photo-out across all seven captures — library from six, reading the
   seventh, seven times over: **89% correct overall, 100% precision on what it
   accepts (95/95), 86% auto-filled, about 2 taps per board.** The score is
   honest, which is exactly what "confidence was a lie" was not: it declines
   rather than guessing, and the threshold is a plateau (100% across 0.91-0.94),
   not a tuned coincidence.

   Two fixes got it there. The crop had **no padding**, so off-centre tokens ran
   off the edge of their own crop — 8 of 18, spotted by eye on a contact sheet.
   And every remaining accepted error was **6-vs-9**, which shape can never
   settle because a 6 turned 180 degrees IS a 9; ink colour settles it
   completely and took precision from 93.7% to 100%.

   **Wired into the reader.** `readToken` now samples the digit
   (`digitSample.ts`) and matches it (`digitShape.ts`) against a bundled library
   harvested from the reference captures (`tokenLibrary.ts`). The port was
   verified by running the shipped modules over the same photos
   (`tools/port_check.mjs`): 88% overall, 96/96 precision, matching the probe.

   Two things went with it. OCR no longer writes to the board — at 1 of 17 it
   would have clobbered a 100%-precise matcher — and is kept only as a
   diagnostic. And `clippedTokenHexes` warns when the board sits so close to the
   frame edge that padded crops run off the photo, which used to fail silently
   and look exactly like unreadable tokens.

   **The device run happened, 25 Aug 2026, and it held: 17/19 exact, 19/19
   terrain, 16/16 of the high-confidence readings correct.** The two errors were
   a 6/8 swap on hexes 10 and 16, and BOTH were flagged low — the player was
   pointed at exactly the tiles that were wrong, which is the design working.
   The corners the player marked are kept as `DEVICE_RUN` in
   `tools/board_shots.py`, so the run reproduces offline exactly.

   **Then the real cause of the remaining failures was found**, and it was not
   red ink or crescent geometry: the face-saturation predicate cut at 0.30 when
   the printed cream measures 0.33–0.37, so **the face failed its own test on
   every photo ever taken** and eight geometry "fixes" had been measured against
   a disc centred on nothing. Moving the cut to 0.45 took sampling from 111/126
   to 126/126, overall 89% → 96%, coverage 86% → 94%, precision holding at 100%.

   **With the token bag applied that finishes the job: 180/180 tokens, 10/10
   boards perfect**, measured leave-one-capture-out across ten captures of two
   layouts. It only works because at most ONE token is declined per board — one
   empty slot leaves exactly one value, so nothing is guessed. Coverage is not a
   comfort metric here; it is what makes the constraint solver exact rather than
   probabilistic.

   **Recognition is therefore closed.** What remains open is the set, not the
   method — see below.

   Caveat, and it is the live one: all captures are of the same physical board.
   Validated across photos, not across Catan sets, so a "teach it your board"
   step may still be needed for a differently printed set. **This is now the
   only open question on the reader.**

   Two things to check in that order: whether the board was aligned to the guide
   (`screenToImage` assumes it was, and off-centre sampling would explain
   confidently wrong reads), and why the confidence signal did not flag them,
   since that is the safety net and it did not catch anything.

8. ~~**Game mode boundary.**~~ Done — `services/modes/` holds a
   `GameModeAdapter` and a registry; `careerStats.ts` now aggregates through it
   and imports nothing Catan. Catan types moved to `types/modes/catan.ts`, with
   `BoardExposureEvent` / `BoardPosition` as the mode-agnostic core in
   `types/boardState.ts`; `models.ts` re-exports the Catan types so existing
   imports still resolve. Also removed a duplicated `CATAN_NUMBERS` (it was
   defined in both `catanStats.ts` and `careerStats.ts` — the same drift risk
   that #65 fixed for chart palettes), and renamed the Catan-flavoured career
   surface (`CatanNumberCareerStat` → `NumberCareerStat`, `summary.catanSessions`
   → `summary.boardModeSessions`, share card `'catan'` → `'production'`).

   **On-disk format deliberately untouched** — no migration, nothing to lose.
   `GameSessionSettings.catan*` flags keep their names because they are storage
   keys. 668 tests pass (9 new in `modeBoundary.test.ts`, including two that pin
   the invariant rather than the behaviour: cross-mode code must not import a
   named game, because behaviour tests would all still pass with the boundary
   bypassed). Full workspace typecheck clean.

   **Not yet done:** `storage.ts` still names Catan event streams
   (`saveExposureEvents`, `loadDevCardEvents`) and validates their shapes. That
   was scoped out on purpose — making persistence generic means a v4 migration
   against data on real devices, and migrations are where this repo's
   silent-corruption bugs have lived.

9. **Accolades engine.** The current feature work. Two tiers, decided: dice-only
   accolades in core (work in any game), mode-specific ones registered by the
   mode adapter. Every player gets their own accolade — the existing share card
   describes it as "Spotlight one player", which is the wrong shape and has been
   reworded.

   **The constraint that shapes the build:** the candidate set must be fixed in
   advance and each accolade's rarity reported against the seeded Monte Carlo in
   `luckEngine.ts`. Searching for "the weird thing that happened" is multiple
   comparisons by construction — the same error as the ±15% band, arriving as a
   feature request. See the statistical stance in `CLAUDE.md`.

10. ~~**Catan board generator.**~~ Done — `services/boardGenerator.ts` plus
    `app/catan-board-generator.tsx`, offered as a third setup path in
    `new-game/catan.tsx` beside Scan and the manual flows. A generated board is
    known by construction, so this is the one path the vision pipeline is not
    involved in at all.

    Toggles: desert centre/anywhere, terrain spread/random, numbers
    balanced/random, harbour positions fixed/shuffled, harbour tiles
    standard/shuffled, harbour affinity random/near/far. Generate-and-score over
    ~400 candidates, with balance and chaos shown plus every raw count beside
    them. Boards are reproducible from the seed shown on screen.

    **A bug measurement caught:** selection originally ranked candidates on one
    shared score, so "completely random" still returned the most balanced of 200
    random boards — 0.03 adjacent red pairs per board. Selection now only
    optimises the constraints the player enabled; reporting still shows
    everything. Measured 1.27 after the fix, and `boardGenerator.test.ts` pins it.

    **Verified:** 690 tests (22 new), full workspace typecheck. Every generated
    board is checked by `validateBoardComposition` and `validatePortLayout`,
    which were written independently of the generator. Also exercised in the
    running app on Expo web: harbour geometry checked numerically (0 clipped, 0
    overlapping, each harbour exactly apothem+16 from its own hex centre), tile
    counts matching the box, and the balanced/random toggle moving every metric
    in the expected direction.

    **Not verified:** never run on a device — this screen and the new harbour
    rendering in `CatanHexGrid` join that list. The full
    new-game → generator → exposure flow was not exercised end to end, because
    the generator was opened directly without a session. And the "fixed harbour
    positions" toggle rests on `STANDARD_PORT_LAYOUT`, which remains unverified
    against any physical edition — see `CLAUDE.md` for what the research did and
    did not settle. The UI says so rather than implying authority.

11. ~~**Exposure entry from the generated board.**~~ Done — when a board was
    generated, settlement setup shows it and players tap the corners they own.
    Numbers and ports are derived from the board rather than transcribed, so
    exposure becomes exact instead of self-reported, and `locationId` is now a
    real board position rather than a random id. Tapping your own settlement
    removes it. Corners taken by another player are blocked. The number pad
    stays one tap away for anyone whose physical board drifted, and remains the
    only path for scanned or hand-entered games.

    **Two silent geometry bugs found and fixed**, both caught by testing the
    mapping rather than by anything failing: corner identity keyed on the set of
    touching hexes collapsed 54 corners to 48 (it is unique only for the 24
    interior ones), and `toFixed` keying split corners in half via negative zero.
    Both are written up in `CLAUDE.md`; ids are positional now.

    **Verified:** 704 tests (14 new in `intersections.test.ts`), full typecheck.
    Also exercised end to end in the running app on Expo web — the flow that was
    listed as unverified when the generator landed: new-game → generator → "Use
    this board" → exposure setup, with 54 distinct corners rendered, a tap on
    the corner of hexes 0/1/4 recording exactly their numbers (4, 5, 10) with
    correct pips, the corner marked in the player's colour, tap-again removing
    it, and the fall-back-to-numbers toggle switching both ways.

    **Not verified:** still never run on a device. Corner taps are small SVG
    touch targets, which is precisely where Android SVG dispatch has bitten this
    project before — web clicks prove the handler wiring, not the touch target.

    **Superseded 26 Aug 2026.** The whole screen was rebuilt on
    `catanPlacement` after device feedback: corners instead of three-hex
    selection, snake draft with free navigation, roads, colour picking,
    per-turn clearing, and the distance rule enforced by only offering legal
    corners. Photo-detected pre-fill was removed as a correctness fix — a piece
    is detected on a HEX and was recorded as touching that one hex, when a
    settlement sits on a CORNER and touches up to three, so every pre-filled
    placement understated its owner's exposure.

12. ~~**Hardening pass before real-life testing.**~~ Done — five issues, four
    of them found by trying to force edge cases rather than by anything failing
    in ordinary use.

    - **Crash: hooks after an early return.** `catan-exposure-quick` called ten
      hooks before the session hydrated and twelve after, so React replaced the
      screen with the error boundary. Triggers on cold start, restart mid-setup,
      or opening the route directly — all plausible at a table. Hooks lifted
      above the `!activeSession` return.
    - **Race: double-tap placed two settlements on one corner.** Place-or-remove
      was decided from a memo, then written — two taps in one render cycle both
      saw an empty corner. One mark on screen, two settlements in state, exposure
      double-counted invisibly. The decision now happens inside the updater.
    - **Barren corner was unusable.** A corner touching only the desert yields no
      numbers, so it was never marked, could not be removed, and every further
      tap appended a duplicate. Board placements are tracked by position now
      (`fromBoard`), not by whether they produce anything.
    - **Corner hit targets were ~12px.** Now a 16-unit invisible target over the
      7-unit dot: ~28dp, verified non-overlapping (corners sit exactly 40 apart).
      The board's geometry caps this below the 48dp guideline.
    - **Generator was a dead end** — no back affordance, and no top inset under
      `headerShown: false`, so its title sat under the status bar on device.
      Both fixed.

    **Verified:** 705 tests, full typecheck, and each fix exercised in the
    running app on the path that broke it — including forcing the desert onto an
    outer hex to reach a barren corner, and firing two taps in one tick to
    reproduce the race.

    **Still not verified:** never run on a device. The hit-target fix is the one
    that most needs a real finger — web clicks prove wiring, not ergonomics.

13. **Store-release prerequisites**, if that's the goal: privacy policy (a photo leaves the device), `ios.bundleIdentifier`, icon and splash review. `android.package` is now set to `com.laxaholic123.skillcheck` — trivial to change now, impossible after release.

14. **Board tracking during play.** Done — `services/catanBoardState.ts` plus
    `components/CatanBoardPanel.tsx`, shown on the active screen behind a
    toggle and on results as "the board at the end".

    **The gap was capture, not rendering.** Roads were already positional and
    so were opening settlements, but a settlement recorded MID-GAME went in as
    `hexIdentifiers: [generateId()]` through a number picker — correct for
    production, invisible on the board, and self-reported rather than derived.
    `catan-development` now offers a corner picker whenever a board is known
    and reads the numbers off it; the number pad remains for boards the app
    does not have, and the two are mutually exclusive on screen.

    **What cannot be drawn is counted.** `BoardSnapshot.unplaceable` carries
    the per-player count of positionless buildings and the panel prints it,
    because a board that quietly omits two of your four settlements looks
    complete while being wrong.

    **Found on the way:** the SCAN path never called `saveActiveBoard`. Only
    the generator did, so for the main photo path there was no board in storage
    and all three of these features would have silently done nothing on exactly
    the games most likely to have a board. The scan screen now hands over the
    reviewed board.

    **Verified:** 19 new tests in `catanBoardState.test.ts`, full typecheck,
    and a static check that no screen gained a hook after its early return —
    the crash this repo has already hit once. **Not verified on a device**, and
    the corner picker is another SVG hit target, which is where this project's
    bugs live.

15. **Live callouts.** Done — `services/liveCallouts.ts`, one line above the
    roll pad on the active screen.

    Descriptive only, and the constraint is the design. Checking after every
    roll is SEQUENTIAL TESTING, so a live "you're unlucky" is wrong far more
    often than it looks; luck claims stay on the results screen where the
    simulation runs. Four rules are enforced rather than trusted: fixed
    candidate set, one callout per roll, a per-kind cooldown, and a test that
    asserts no luck/probability/skill word ever appears in emitted text.

    **Measuring caught the fourth instance of this repo's oldest bug.** The
    "number is back after a long absence" callout used a flat 18-roll gap
    across eleven outcomes with different frequencies — extraordinary for a 6
    (expected gap 7.2), routine for a 2 (expected gap 36). It fired once every
    16 rolls, more than every other kind combined. Scaling to each number's own
    expected gap took the feature from 14.3% of rolls to 9.4% with no kind
    dominating. Nothing about the code looked wrong.

    **Verified:** 20 new tests including the rate measurement over 3600 fair
    rolls and the forbidden-word test. Not run on a device.

16. **Harbours: the layout cannot be static, and now it turns.** Partly done.

    `tools/port_probe.py` locates harbour badges from a photo — they are cream
    floating in blue sea, which separates far more cleanly than anything on the
    island, provided blobs are required to be ENCLOSED BY SEA (without that,
    the three biggest "badges" are the white tablecloth). 8 of 9 on DEVICE_RUN.

    Snapping those to coastal edges produced the finding: **STANDARD_PORT_LAYOUT
    fits at 60/180/300 degrees and not at 0.** Every harbour is right relative
    to the others; only the anchoring is wrong — and it is not a transcription
    error. The frame stays assembled while tiles are reshuffled, and the app's
    hex numbering comes from whichever corner the player taps first, so the
    ring's rotation is arbitrary game to game. **No stored layout can be right
    in general.**

    **Superseded: POSITIONS ARE NOW READ, and the rotation control is gone.**
    Turning the ring was the right fix for the measurement above, but it
    assumed the frame was only ever ROTATED. A frame whose harbours have been
    reshuffled cannot be reached by any rotation, and that is a board people
    own. Reported as "do what it takes to recognize those harbors reliably".

    Shipped: `services/vision/harbours.ts` finds the badges,
    `services/vision/harbourRing.ts` pins them against the coastal ring, and
    the capture screen reads them off the same photo as the tiles. The review
    screen shows what was found and lets the player tap any harbour to set what
    it trades; `services/catanPorts.ts` keeps `rotatePortLayout` for the case
    where nothing was detected, and adds `shiftPortTypes` for moving labels
    across fixed positions.

    **The constraint is the whole trick.** Cream blobs give 11-22 candidates a
    photo and no tuning removed them. Nine harbours on a thirty-edge coast
    spaced 3 or 4 apart forces six 3s and three 4s, so only 280 legal rings
    exist; score all of them and a dock timber cannot join one. Measured
    90/90 harbours over ten captures (`tools/harbour_probe.py`), 469ms on a
    12MP photo.

    **Measured limit, and it shaped the design:** the constraint cannot recover
    a harbour with ZERO evidence when its neighbours are 7 edges apart, because
    7 splits both as 3+4 and 4+3 — and six of the nine sit in 7-spans. Hence
    dense graded scoring over all thirty edges rather than a list of confident
    hits, and hence `selectRing` returning `unsure` so the screen can ring the
    undecided ones in amber instead of bluffing.

    **TYPES ARE READ TOO**, after three attempts that failed and are worth
    keeping: saturated-pixels measured the sea, bright-non-cream discarded ore
    and lumber for being dark, and every attempt measured a square containing
    boat. What works is rectifying in badge space, working inside the card, and
    taking the icon as the largest non-cream blob whatever colour — because ore
    is grey and wool is white, and those were exactly the two that kept
    swapping. `services/vision/harbourTypes.ts`, 92.2% with the composition
    constraint against 80.0% without, seven of ten captures exact.

    Verified against the PHOTOS by `tools/harbour_type_check.mjs`, not against
    tests that agree with the port: all 13 features match Python to 1.11e-16 on
    the same 90 badges, with the same misses. Ports feed `portAccess` only, so a
    wrong type misreports trade access and nothing else — and the constraint
    guarantees the board is at least legal.

    **Verified:** `catanPorts.test.ts` (19, including that every harbour stays
    coastal at all six rotations), `harbourRing.test.ts` (15, including the 6/9
    ambiguity as a pinned number), `harbours.test.ts` (10, against a synthetic
    board carrying a tablecloth and a dock timber), `portsFromDetected.test.ts`
    (12, including that shift still works after the player corrects one — an
    earlier design killed that control silently), `harbourTypes.test.ts` (12,
    including that the answer is a legal bag for ANY input and that the
    assignment is exhaustive rather than greedy).

17. **Settlement Setup could strand you on "Player 5 of 4".** Fixed, and this
    one was on the critical path of every game.

    `handleNextPlayer` read `isLastPlayer` from the render and then called
    `setCurrentPlayerIdx(i => i + 1)`. Two taps inside one render cycle both
    decide "not the last player" and both increment, so the index walks past the
    end of the roster. The result is a screen showing a player who does not
    exist, a Next button that names nobody and does nothing, and no way forward.

    This is the SAME read-then-write race that double-placed a settlement on one
    corner, in a different handler on the same screen, a week after that one was
    fixed. Treat it as a pattern: on this screen, decide inside the updater or
    make the repeat idempotent.

    Fixed by `nextSetupPlayerIndex` — a clamped ABSOLUTE index, so a second tap
    in the same tick sets the same value — plus a ref guard on
    `handleStartGame`, because `isSaving` is state and two synchronous calls
    both read it as false. Turn rotation still wraps (`getNextPlayerIndex`);
    setup deliberately does not.

    **Found and fixed on WEB before any device saw it**, by firing four taps
    into one tick. Verified: the same burst now advances 1 → 2 instead of
    1 → "5 of 4". 5 new tests in `activeGameHandlers.test.ts`.

18. **Touch dispatch probe.** `app/touch-probe.tsx` — a diagnostic, reachable
    only by URL, nothing links to it.

    Seven variants side by side with tap counters: transparent Circle (what
    corners and roads use today), zero-opacity fill, near-transparent paint,
    Rect, handler on a `<G>`, an RN `<Pressable>` baseline, and `onLongPress` as
    the control. Whichever counters move are the primitives that receive touches
    on that build.

    It exists because "tapping does nothing" has three different causes here —
    primitive, geometry, wiring — and they are indistinguishable on a real
    screen. This turns an evening of guessing into a named cause in a minute.

    Measured on web: transparent Circle FIRES, `<G>` fires, `onLongPress` does
    not. The browser console explains the last one — react-native-svg passes
    `onLongPress` and every RN responder prop straight to the DOM and React
    ignores them, so `onClick` is the only surviving handler on web. A second
    platform independently confirming the Android finding.

    **Run this first tonight.** If F moves and A does not, corners and roads
    both need a Pressable overlay and everything else on the placement screens
    is a red herring.

19. **Web verification works again**, which is how 17 was found.

    The preview config pointed at a temp `.bat` in a dead session's scratchpad.
    Two cwd traps behind it, both now in `CLAUDE.md`: `pnpm --filter … exec`
    runs from the repo ROOT (Metro then resolves nothing), and babel resolves
    `babel-preset-expo` from the process cwd, where it is linked only under
    `artifacts/dice-tracker/node_modules`. Both present as a broken project and
    neither is one.

    Verified end to end on web this session: generator → exposure by corner tap
    with numbers derived from the board → game screen. Board panel renders with
    its honesty line ("4 buildings · 0 roads on the board"), the live callout
    fires ("3 8s in a row."), and the roll pad shows 7 plus all ten numbers.

    Still unproven anywhere: Android touch dispatch, which is the whole point of
    the device session.

20. **The robber moves onto TILES, and blocks now lift.** Done, and it turned up
    a correctness bug worse than the UX one that prompted it.

    **Blocks never ended.** Every 7 wrote a `robberBlockStarted` and nothing
    wrote the matching end except a manual action in the development modal.
    Blocked numbers only accumulated, so production was progressively
    under-counted for the rest of the game — silently, and in the direction
    that makes a player look unluckier than they were.

    **And it blocked a number rather than a tile**, so a player whose second 5
    was across the board lost production the robber never touched.

    `services/catanRobber.ts` models one robber on one hex. A move returns the
    ends and the starts together so it cannot be half-applied, and who is
    blocked is derived from the tile's six corners instead of asked for. The
    prompt shows the board. A Robber pill covers knights, which previously had
    no path at all. 13 new tests.

    Knock-on: `blockedWeightForNumber` was a documented ESTIMATE ("charge the
    largest single share") because capture only knew the number. With the hex
    recorded it is exact. Both modes remain — every block written before this
    has no hex, and the estimate is the honest reading of those.

21. **"Are all rolls and exposures captured?" — answered with a measurement.**
    `tools/capture_audit.mjs` recomputes the whole production ledger from the
    raw event log, independently of the shipped helpers, and compares.

    **0 mismatches across 420 player-ledgers, 5 seeds.**

    Two false alarms on the way, both worth remembering. The first run found 32
    mismatches that were my own error — the independent pass zeroed all
    production on a blocked number, when the shipped code correctly charges one
    tile's worth. The second found 18, which was a silently failed esbuild
    leaving the harness measuring stale code. A disagreement between two
    implementations means one is wrong; check which before believing the new
    one, and check the bundle actually rebuilt.

22. **Results now lead with "did your numbers come up?"** Done —
    `services/exposureReport.ts`.

    Mean and median roll were the headline and are nearly irrelevant: nobody
    finishes a game wondering whether the mean was 7.1, and a table where
    everybody's numbers landed can share a mean with one where nobody's did.
    The new lead is per player — the numbers they hold, how heavily, how often
    each came up, and par for a run of that length.

    Every figure is a count or a difference of counts, par is always relative
    to the rolls actually made, and a test asserts the wording never becomes a
    luck claim. Whether a gap is remarkable stays with the percentile, which
    has the simulation behind it. 14 new tests.

23. **Accolades carry their whole table.** Done. Tapping a card opens the full
    ranking on that axis with every player's value, the reader highlighted. A
    rank with no way to see the other places is a horoscope with a number in
    it, and the ranking was already computed to produce the badge.


24. **A day with no device: three things fixed by counting.** All found without
    running the app, which is the point — none would have failed a test.

    **Saved layouts threw away their harbours, both ways.**
    `CatanBoardLayout.ports` was written by every save and read back by nothing:
    `handleLoadLayout` set only hexes, `handleSaveLayout` passed no ports, so
    the `?? [...STANDARD_PORT_LAYOUT]` fallback fired every time and stored the
    rulebook frame over whatever had been read or corrected. Fixed both halves;
    `boardLayouts.test.ts` now asserts a non-standard frame round-trips AND is
    not the standard one.

    **The swallowed storage failures got the voice built for them.**
    `reportHandledError` says in its own docstring that storage failures are
    invisible without it, and nothing called it. Counted 87 catch blocks, 24
    completely empty, 15 of those in `storage.ts`. All 29 sites there now
    report through an INJECTED reporter — crashReporting imports Sentry at
    module scope and cannot load under ts-jest, which would take
    `storage.test.ts` down. Injection also made the voice testable.

    **"3 to check" on a board that was 19/19 right.** Measured with
    `tools/confidence_audit.mjs`: 126/126 tokens correct, 5 flagged, 0 of the 5
    actually wrong, 0 wrong-and-unflagged. All five were the same case — the
    reader declined and the solver filled from the remaining tokens. The flag
    was not miscalibrated, the wording was, including "the scan didn't match the
    pieces in the box", which is false for a decline. The screen now branches on
    `change.from`: null means "could not read it, worked it out" in calm words,
    non-null means "this could not be true" and keeps the alarm.

    Still open from the same feedback batch: **reading confirmation** after the
    read button is pressed.

25. **The results screen answers "was I unlucky?" before "were the dice fair?"**
    Reported as wanting a per-player verdict rather than an overall one.

    `productionLuckPercentile` was already computed per player — it was rendered
    near the bottom of the screen in small grey note text, under the findings
    and beside the trademark disclaimer, while the VERDICT card at the top
    answered a question nobody asks. The card now carries a row per player,
    unluckiest first, with the tails coloured and the middle deliberately not.

    `labelForBand` and `isNotableBand` in `luckEngine.ts`, pinned by four tests.
    The duplicate list at the bottom is gone; one screen should not answer the
    same question twice.

    NOT verified on a device or on web — typecheck and tests only. The layout of
    the new rows is unproven.

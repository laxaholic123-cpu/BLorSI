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

- **Settlement distance rule in board-mode exposure entry.** Settlements must be
  two edges apart; the app blocks occupied corners but not adjacent ones. Agreed
  as low priority: at a real table the other players enforce it, so a violating
  placement is unlikely to be entered in the first place. Worth adding as a
  non-blocking warning (not a block) when there is time — it would catch a
  mis-tap, which is the realistic failure, rather than an illegal placement.

**Lower**

- **#22 Skip the action-picker from the game screen.** Looks done — direct `?action=add_settlement` / `?action=upgrade_city` links exist.
- **#11 Live Catan production during the game.** Looks done — `CatanProductionLeaderboard` is on the active screen.
- **#43 Escape the "Reading the board…" spinner.** Client has cancel affordances; the server now enforces a 45s timeout and returns a usable 504.
- **#16 Bluetooth dice reader.** Unstarted, large, and needs a dev build to even prototype.
- **#40 Board scan on a real Android device.** Blocked on the provider decision and a device pass.

---

## Not in the original 31, but now on the critical path

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
    also differ between editions, and there is still no port editor in the app.

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

   **Remaining:** validation on real device captures. Every measurement so far
   used one board with hand-marked corners; a perfect score on a single sample is
   exactly when to be suspicious. The capture screen exists so those photos can
   finally be taken.

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

    **Deliberately not done:** the two-edges-apart distance rule is not enforced.
    Occupied corners are blocked because that is unambiguous, but this is a
    recording tool, not a referee, and a mis-tap is visible in the settlement
    list.

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

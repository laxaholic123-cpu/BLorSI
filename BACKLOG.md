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

**Lower**

- **#22 Skip the action-picker from the game screen.** Looks done — direct `?action=add_settlement` / `?action=upgrade_city` links exist.
- **#11 Live Catan production during the game.** Looks done — `CatanProductionLeaderboard` is on the active screen.
- **#43 Escape the "Reading the board…" spinner.** Client has cancel affordances; the server now enforces a 45s timeout and returns a usable 504.
- **#16 Bluetooth dice reader.** Unstarted, large, and needs a dev build to even prototype.
- **#40 Board scan on a real Android device.** Blocked on the provider decision and a device pass.

---

## Not in the original 31, but now on the critical path

1. **Device verification.** Five commits of UI change, none run on a phone: dev card entry, port selector, quick-exposure tap behaviour, board-review corrections, results percentile column, home screen backup link. All typecheck-clean and logic-tested; none exercised where this project's bugs historically live (Android SVG touch dispatch).
2. ~~**Crash reporting.**~~ Done — `services/crashReporting.ts`, wired into the root layout. Inert without `EXPO_PUBLIC_SENTRY_DSN`, so it collects nothing until a DSN is set. Still worth reporting the storage failures that are deliberately swallowed: those are invisible by design, which is exactly why they need a voice.
3. **Board scan provider decision.** Model and base URL are configuration now, but nothing works until a key and a reachable model are chosen. `EXPO_PUBLIC_DOMAIN` also needs repointing off the Replit domain.
4. ~~**`expo-av` is deprecated.**~~ Done — migrated to `expo-audio`. The new player
   is synchronous to create and control, so the old async cache-and-await dance is
   gone. Done on a quiet day rather than under SDK 55 upgrade pressure, which was
   the point.

5. **Always use `expo install`, never `pnpm add`, for anything with native code.**
   Not a task, a rule — learned the hard way. Four packages (`expo-document-picker`,
   `expo-media-library`, `expo-sharing`, `react-native-view-shot`) had been added
   with plain `pnpm add`, so they resolved to `latest` from an SDK that does not
   exist for this project. The result was a development build that died during
   native module registration, before any JS ran. `expo install` picks the
   SDK-compatible version; `pnpm add` does not know the SDK exists.
   Run `pnpm exec expo install --check` after adding any dependency.

6. **Local board scanner.** Substantially built:
   - Homography, canonical board geometry, OCR-free token decoding, binary
     primitives, and terrain colours calibrated from a twelve-photo reference set.
   - `reconcileBoardFromEvidence` combines colour and the has-a-token cross-signal
     in one global assignment, so confident tiles rescue uncertain ones.
   - `services/vision/pixelSource.ts` bridges to react-native-skia for pixel access.
   **Measured, and it settled a design question:** fully automatic board
   detection was prototyped (`tools/detect_probe.py`) and does NOT work — mean
   tile-count error 22.7 of 19 across the reference set, no better than chance.
   The decisive reason is not the algorithm: **ten of twelve reference photos are
   close-ups with the board partly out of frame**, so there is nothing to detect.
   That is what people actually photograph.

   So the geometry must be supplied rather than inferred. Preferred: a live
   camera guide the player aligns the board to, which costs zero taps and fixes
   the homography before a pixel is read. Fallback: four corner taps on a still.

   **Remaining:** the capture step, and an end-to-end accuracy run with correct
   geometry — still unmeasured, and the number that decides whether local
   scanning ships as primary or stays behind the AI.
7. **Store-release prerequisites**, if that's the goal: privacy policy (a photo leaves the device), `ios.bundleIdentifier`, icon and splash review. `android.package` is now set to `com.laxaholic123.skillcheck` — trivial to change now, impossible after release.

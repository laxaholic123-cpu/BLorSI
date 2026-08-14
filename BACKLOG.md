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
| 55 | Regressions in production luck / heat-map colouring | Production luck now has real coverage (`catanProductionWeights`, `luckEngine`, `verdictSimulation`). Heat-map colouring still uncovered — see #65. |
| 56 | Regressions in career stat aggregation | `careerStats.test.ts` covers it. One fixture was wrong (a settlement on number 7) and has been fixed. |

## Addressed by the storage rework — verify and close

| # | Task | What changed |
|---|---|---|
| 33 | Robber-tracking data loss when storage fails on a 7 | Robber block writes go through the same re-throwing path as rolls; callers surface failure. Worth a deliberate test with storage forced to fail. |
| 34 | Roll data consistency if a save fails mid-game | `persistRollEvents` re-throws and `active-catan` rolls back the in-memory state on failure. |
| 35 | Player rename silently dropped when storage unavailable | Same re-throwing path via `updateSession`. |
| 61 | Stuck on results if `endSession` fails silently | Handled: `confirmEndGame` navigates to `/results` whether or not the write succeeds, so nobody gets trapped. **Residual issue worth its own ticket:** on failure the session is never marked `completed`, so it silently resumes as active on next launch and the player is told nothing. Trapping was the bug; the silence is still there. |

## Still open, in the order I'd take them

**High — these change what a user sees**

- **#15 Light theme.** Largest untouched user-facing item. Mostly mechanical now that everything reads from `useColors`.
- **#65 Heat-map colour consistency.** Confirmed still wrong: `CatanRollHeatMap` uses `#EF4444` red / green, while `RollFrequencyChart` uses the teal/blue palette. Two charts, two visual languages, same data.
- **#57 / #63 Number performance as a bar chart on the verdict card.** `RollFrequencyChart` is on results but **not** on `share-card.tsx` — the share card is the growth loop and has no chart.
- **#58 Share career stats and head-to-head.** `shareCard.ts` has no career path at all.
- **#59 / #62 Share card correctness on device.** Untouched, and now genuinely blocked on a device pass.

**Medium — correctness and flow**

- **#13 / #54 Robber blocks on the game screen.** #13 looks done (`activeRobberBlocks` is computed and rendered). #54 (lift a block without leaving the screen) is **not** — `robberBlockEnded` only exists in `catan-development.tsx`.
- **#45 Hex correction panel allowing a non-desert hex with no number.** The panel nulls the number for desert, but I found no guard preventing a *productive* hex from being saved without one. The constraint solver now repairs this after a scan, but manual correction can still create it.
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
2. **Crash reporting.** Still none. Every bug report is "it crashed sometimes", which is a bad position to be in right after reworking the storage layer.
3. **Board scan provider decision.** Model and base URL are configuration now, but nothing works until a key and a reachable model are chosen. `EXPO_PUBLIC_DOMAIN` also needs repointing off the Replit domain.
4. **Local board scanner.** Constraint solver — the hard, reusable half — is built and already improving the AI path. The CV half is blocked on sample photos.
5. **Store-release prerequisites**, if that's the goal: privacy policy (a photo leaves the device), `ios.bundleIdentifier`, icon and splash review. `android.package` is now set to `com.laxaholic123.skillcheck` — trivial to change now, impossible after release.

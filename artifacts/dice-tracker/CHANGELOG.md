# Changelog — Skill Check

All notable changes are documented here. The project follows a phased release plan; each phase is committed separately.

---

## [Phase 6] — Polish, Accessibility & Final Review — 2026-07-21

### Added

- **Sound service** (`services/sound.ts`) — optional expo-av audio feedback for rolls, undo, and game completion; caches `Audio.Sound` instances; respects `settings.soundEnabled`; silent on failure
- **WAV audio assets** (`assets/sounds/roll.wav`, `undo.wav`, `done.wav`) — 22 kHz mono 16-bit PCM; generated programmatically; short (55–180 ms) to feel snappy not obtrusive
- **Reduced-motion support** — `NumberButton` reads `settings.reducedMotion` and skips the scale animation entirely for users who prefer no motion
- **Comprehensive accessibility labels** — `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint` added to all interactive elements across: `NumberButton`, `active-game.tsx`, `active-catan.tsx`; `accessibilityState` propagated for disabled states

### Changed

- **NumberButton** — imports `useSettings`; skips Animated.sequence when `reducedMotion` is true; roll buttons are properly labeled for screen readers
- **active-game.tsx** — End Game, Undo, Prev, Next, Stats buttons carry accessibility props; sound calls wired into `handleRoll`, `handleUndo`, and game-end confirm handler
- **active-catan.tsx** — same as above; 7/Robber button and number grid buttons are labeled; Dev button labeled
- **new-game/general.tsx** — `useState` initializers read `settings.defaultDiceMode`, `settings.defaultPlayerCount`, `settings.defaultAutoAdvance`; `useEffect` on mount reads and applies `loadPrefillSession()` then clears it
- **new-game/catan.tsx** — same pattern; player count clamped to 3–6; Catan-specific settings (trackWinner, trackPlacements, robberTracking) restored from prefill
- **README.md** — complete rewrite: all features documented, project structure updated through Phase 6, statistical methodology, data model, known limitations, recommended next steps, migration checklist
- **ARCHITECTURE.md** — navigation table updated, Sound domain added, Accessibility section added
- **DECISIONS.md** — D9 (WAV choice), D10 (sound caching), D11 (react-native-view-shot) added; D7 note updated

### Tests

- **`__tests__/storage.test.ts`** — 15 new tests: `importAllData` (valid/invalid JSON, multi-session, Catan exposures, idempotency), prefill round-trip (save, overwrite, clear, field fidelity)
- **Total: 146 tests, 3 suites — all passing**

---

## [Phase 5] — History, Sharing & Settings — 2026-07-21

### Added

- **History screen** (`(tabs)/history.tsx`) — full session list with roll counts, duration, player color dots, winner, verdict, filter tabs (All/Completed/Active), long-press delete, active-session resume routing
- **Session detail** (`session-detail.tsx`) — read-only results view for any past session: verdict, distribution, Catan production, notable events; actions: Share, Share as Text, Duplicate Setup, Delete
- **Share card modal** (`share-card.tsx`) — 5 card types: Verdict, Game Summary, Player Accolade, Rivalry (2-player), Catan Production; image capture via `react-native-view-shot`; save to Photos via `expo-media-library`; text share via `Share.share()`
- **Settings info modal** (`settings-info.tsx`) — Methodology, Catan Compatibility Notice, Privacy Summary, About pages
- **Storage helpers** — `importAllData`, `savePrefillSession`, `loadPrefillSession`, `clearPrefillSession`
- **New packages** — `expo-sharing`, `expo-media-library`, `react-native-view-shot`, `expo-document-picker`, `expo-av`

### Changed

- **Settings screen** — fully implemented: haptics/sound/reduce-motion toggles, game defaults (dice mode, player count, auto-advance), data export/import/clear all, information links
- **`_layout.tsx`** — registered `session-detail`, `share-card`, `settings-info` routes

---

## [Phase 4] — Catan-Compatible Mode — 2026-07-21

### Added

- **Catan setup screen** (`new-game/catan.tsx`) — player count (3–6), color assignment, auto-advance, winner/placement/robber tracking, disclaimer; Quick Setup / Detailed Setup CTAs
- **Exposure setup** (`catan-exposure-quick.tsx`, `catan-exposure-detailed.tsx`) — per-player hex number assignment; quick mode uses fixed weights, detailed mode enters actual counts; produces `CatanPlayerExposureEvent` records
- **Active Catan screen** (`active-catan.tsx`) — 2D6 grid with prominent 7/Robber button, robber prompt modal, in-game robber/settlement/city tracking
- **Catan development modal** (`catan-development.tsx`) — building action recorder for settlements, cities, road-building events
- **Catan statistics** (`services/catanStats.ts`) — exposure-weighted production analysis, robber impact, expected vs. actual per player
- **Catan verdict** (`services/catanVerdict.ts`) — copy generation for Catan game results

### Tests

- **56 new tests** across `catanStats.test.ts` and `catanVerdict.test.ts` — total 131 tests

---

## [Phase 3] — Statistics & Verdicts — 2026-07-21

### Added

- **Statistics service** (`services/stats.ts`) — frequency, deviation, streaks, droughts, player comparisons; 75 unit tests
- **Verdict service** (`services/verdict.ts`) — humorous end-of-game copy based on statistical profile
- **Live stats modal** (`stats.tsx`) — accessible from active game; shows roll distribution, streaks, player breakdown
- **Results screen** (`results.tsx`) — post-game: final verdict, distribution chart, multiplayer breakdown, winner recording

---

## [Phase 2] — Active Game — 2026-07-21

### Added

- **Roll recording** (`services/rollInput.ts`) — `recordRoll`, `undoLastRoll`, `getNextPlayerIndex`, `getPrevPlayerIndex`; all roll sources use this single entry point
- **DiceGrid component** — responsive layout with `onLayout`; switches to TextInput keypad for ranges > 20 values
- **NumberButton component** — scale animation on press, highlighted state for last-pressed value
- **Active game screen** (`active-game.tsx`) — live roll entry, player banner with last-5-roll pills, player name inline editing, auto-advance, undo, end-game with confirmation
- **Session resume** — Home screen detects an active session and shows a Resume button

---

## [Rebrand] — Skill Check — 2026-07-21

### Changed

- App name: "BAD LUCK OR SKILL ISSUE?" → **Skill Check**
- Primary color: amber/gold → teal `#1ABC9C`
- Wordmark: ✓ SKILL CHECK with trademark-style lock-up

---

## [Phase 1] — Foundation — 2026-07-21

### Added

- **Expo app scaffold** — Expo SDK 54, React Native 0.81, TypeScript strict mode, Expo Router
- **Data models** (`types/models.ts`) — `Player`, `GameSession`, `RollEvent`, `CatanPlayerExposureEvent`, `AppSettings`; supporting types and constants
- **Persistence layer** (`services/storage.ts`) — AsyncStorage wrapper, `blosi:` key prefix, schema version 1
- **GameContext** — active session and roll events in memory; writes through to AsyncStorage
- **SettingsContext** — `AppSettings` in memory; persists on change
- **Navigation** — 3-tab layout (Home, History, Settings); modal stack for New Game, Active Game, Results
- **Home screen** — Quick Game, New Game, Resume, History actions
- **Dark charcoal + teal theme** — design tokens in `constants/colors.ts`
- **Documentation** — README, ARCHITECTURE.md, DECISIONS.md, CHANGELOG.md

# Changelog — BAD LUCK OR SKILL ISSUE?

All notable changes are documented here. The project follows a phased release plan; each phase is committed separately.

---

## [Phase 1] — Foundation — 2026-07-21

### Added

- **Expo app scaffold** — Expo SDK 54, React Native 0.81, TypeScript strict mode, Expo Router file-based navigation
- **Data models** (`types/models.ts`) — complete TypeScript interfaces for `Player`, `GameSession`, `RollEvent`, `CatanPlayerExposureEvent`, `AppSettings`; supporting types `RollSource`, `DiceMode`, `GameType`, `GameStatus`; constants `DICE_RANGES`, `PLAYER_COLORS`, `SCHEMA_VERSION`, `DEFAULT_SETTINGS`, `generateId()`
- **Persistence layer** (`services/storage.ts`) — AsyncStorage wrapper with `blosi:` key prefix, schema version 1, per-session storage, session index, active session tracking, export/import, clear-all
- **GameContext** (`context/GameContext.tsx`) — React context for active session and roll events in memory; all writes flow through to AsyncStorage
- **SettingsContext** (`context/SettingsContext.tsx`) — React context for `AppSettings`; persists on every change
- **Navigation structure** — 3-tab layout (Home, History, Settings); stack screens for New Game (modal), Active Game, Results
- **Home screen** — product name, tagline, Quick Game / New Game / Resume / History actions, coming-soon sign-in modal
- **New Game screen** — game type picker (General Dice Game, Catan-Compatible Mode, Custom Game) with route stubs for each
- **History screen** — empty state (full implementation Phase 5)
- **Settings screen** — haptics, sound, reduced motion toggles; info and data action stubs
- **Dark charcoal + amber/gold theme** — design tokens in `constants/colors.ts`
- **App icon** — generated premium tabletop electronics aesthetic
- **Documentation** — README (install, Expo Go, Android emulator, project structure, migration checklist), ARCHITECTURE.md, DECISIONS.md, .env.example

### Architecture

- Storage engine: AsyncStorage (rationale in DECISIONS.md D1)
- Roll events: immutable, event-sourced (D2)
- No backend — fully local (D5)
- UUID generation: timestamp + random (D6)

---

## Upcoming

- **Phase 2** — Active game: number-button entry, RollInputService, player advancement, undo/correction, session resume
- **Phase 3** — Statistics module (pure functions, unit tests), live stats screen, verdict framework, results screen
- **Phase 4** — Catan-Compatible Mode: exposure tracking, robber events, production statistics
- **Phase 5** — Game history, share cards, native share sheet, settings actions
- **Phase 6** — Polish, accessibility audit, sound integration, final review

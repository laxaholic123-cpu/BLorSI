# Architecture — BAD LUCK OR SKILL ISSUE?

## Overview

A local-first Expo mobile app built in a pnpm monorepo. All game data lives on-device. No backend is required for core functionality.

## Storage

**Chosen engine:** `@react-native-async-storage/async-storage`

**Why AsyncStorage over expo-sqlite:**
- No native build step — works in Expo Go without ejecting
- JSON serialization matches the event-log data model (no complex relational queries needed)
- Simple migration path: versioned JSON with a `schemaVersion` field
- expo-sqlite adds value when querying across many rows; our workloads are small per-session

**Key prefix:** `blosi:` (avoids collisions if AsyncStorage is reused)

**Schema version:** `blosi:schema_version` → integer. Migrations run at app startup via `ensureSchemaVersion()`.

**Key layout:**
```
blosi:schema_version        → integer
blosi:settings              → AppSettings JSON
blosi:session_ids           → string[] (ordered, newest first)
blosi:active_session_id     → string | null
blosi:session:{id}          → GameSession JSON
blosi:rolls:{sessionId}     → RollEvent[] JSON
blosi:exposures:{sessionId} → CatanPlayerExposureEvent[] JSON
```

All reads/writes are wrapped in try/catch. A storage failure is never fatal to the UI.

## Domain Separation

The codebase is organized into clear domains as required by the product spec:

| Domain | Location | Responsibility |
|---|---|---|
| Data models | `types/models.ts` | TypeScript interfaces, constants, ID generator |
| Persistence | `services/storage.ts` | AsyncStorage read/write, schema migration, export |
| Game state | `context/GameContext.tsx` | Active session in memory, writes through to storage |
| Settings | `context/SettingsContext.tsx` | App settings in memory, persists on change |
| Navigation | `app/` (Expo Router) | File-based screens and layouts |
| UI | `app/` screen files + `components/` | Rendering only, no direct storage access |
| Statistics | `services/stats.ts` (Phase 3) | Pure functions, no side effects |
| Verdict text | `services/verdicts.ts` (Phase 3) | Copy layer, separate from math |
| Roll recording | `services/rollInput.ts` (Phase 2) | Single entry point for all roll sources |
| Share cards | `components/ShareCard.tsx` (Phase 5) | Renderable card components |

## Navigation

Expo Router with two-level structure:

```
/                           → (tabs)/index.tsx    (Home)
/history                    → (tabs)/history.tsx  (History)
/settings                   → (tabs)/settings.tsx (Settings)
/new-game                   → new-game/index.tsx  (game type picker, modal)
/new-game/general           → general dice setup
/new-game/catan             → Catan-Compatible setup
/new-game/custom            → custom range setup
/active-game                → active-game.tsx     (full-screen, no back gesture)
/results                    → results.tsx         (post-game screen)
```

The New Game flow is presented as a modal (slides up from below). Active Game disables swipe-to-dismiss so users can't accidentally leave mid-game.

## Data Flow

```
User taps button
  → RollInputService.recordRoll()    (Phase 2)
    → Creates RollEvent
    → Calls GameContext.persistRollEvents()
      → Updates in-memory state
      → AsyncStorage.setItem()
  → UI re-renders from context
```

Statistics are always calculated on-the-fly from the raw event log, never stored as aggregates. This ensures correctness after undo/correction.

## Future Extensibility

- **Cloud sync:** Replace storage calls in `GameContext` with an API client; AsyncStorage becomes a local cache with conflict resolution
- **Bluetooth input:** Implement the `RollSource = 'bluetooth'` path in `RollInputService`
- **Friend groups:** Add a `userId` field to `Player` and `GameSession`; sync becomes a filter/merge operation
- **Premium analytics:** Stats module is pure functions — new packs are additional exports with no coupling to core

## Portability

The project has zero Replit-specific runtime dependencies. It can be:
1. Cloned from GitHub
2. Installed with `pnpm install`
3. Run with `pnpm --filter @workspace/dice-tracker run dev`
4. Continued with Claude Code without restructuring

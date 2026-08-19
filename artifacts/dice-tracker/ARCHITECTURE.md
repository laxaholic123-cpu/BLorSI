# Architecture — Skill Check

## Overview

A local-first Expo mobile app built in a pnpm monorepo. All game data lives on-device. No backend is required for any Phase 1–6 feature.

## Storage

**Chosen engine:** `@react-native-async-storage/async-storage`

**Why AsyncStorage over expo-sqlite:**
- Simple JSON persistence with no native build step of its own
  (NOTE: the app as a whole no longer runs in Expo Go — react-native-keyboard-controller,
  Skia and expo-camera all require a development build.)
- JSON serialization matches the event-log data model (no complex relational queries needed)
- Simple migration path: versioned JSON with a `schemaVersion` field
- expo-sqlite adds value when querying across many rows; tabletop game sessions are small (hundreds of events max)

**Key prefix:** `blosi:` (avoids collisions if AsyncStorage is ever reused)

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
blosi:prefill_session       → GameSession | null  (duplicate-setup shortcut)
```

All reads/writes are wrapped in try/catch. A storage failure is never fatal to the UI.

## Domain Separation

| Domain | Location | Responsibility |
|---|---|---|
| Data models | `types/models.ts` | TypeScript interfaces, constants, ID generator |
| Persistence | `services/storage.ts` | AsyncStorage read/write, schema migration, export/import, prefill |
| Game state | `context/GameContext.tsx` | Active session in memory; all writes flow through to AsyncStorage |
| Settings | `context/SettingsContext.tsx` | App settings in memory; persists on every change |
| Navigation | `app/` (Expo Router) | File-based screens and layouts |
| UI | `app/` screen files + `components/` | Rendering only; no direct storage access |
| Statistics | `services/stats.ts` | Pure functions, no side effects |
| Verdict copy | `services/verdict.ts` | Copy layer; separate from math |
| Roll recording | `services/rollInput.ts` | Single entry point for all roll sources |
| Catan statistics | `services/catanStats.ts` | Exposure-weighted analysis; pure functions |
| Catan verdict | `services/catanVerdict.ts` | Catan-specific copy layer |
| Sound | `services/sound.ts` | Optional expo-audio playback; players built once, fire-and-forget, gated on settings |
| Share cards | `app/share-card.tsx` | Card rendering + image capture via react-native-view-shot |

## Navigation

Expo Router with two-level structure:

```
/                               → (tabs)/index.tsx         Home
/history                        → (tabs)/history.tsx        Session history
/settings                       → (tabs)/settings.tsx       Settings
/new-game                       → new-game/index.tsx        Game-type picker (modal)
/new-game/general               → General dice setup
/new-game/catan                 → Catan-Compatible setup
/new-game/quick-game            → Quick-launch shortcut
/active-game                    → Live roll-entry (general)
/active-catan                   → Live roll-entry (Catan)
/catan-exposure-quick           → Quick exposure setup
/catan-exposure-detailed        → Detailed exposure setup
/catan-development              → In-game building actions (modal)
/results                        → Post-game results + verdict
/stats                          → Live stats (modal, in-game)
/session-detail?id=<id>         → Historical session detail
/share-card?id=<id>             → Share card composer (modal)
/settings-info?type=<type>      → Static info pages (modal)
```

The New Game flow is presented as a modal (slides up from below). Active Game disables swipe-to-dismiss so players can't accidentally leave mid-session.

## Data Flow

```
User taps roll button
  → NumberButton.handlePress()
      → RollInputService.recordRoll()    — creates immutable RollEvent
        → GameContext.persistRollEvents()
            → Updates in-memory state
            → AsyncStorage.setItem()
  → SoundService.playRollSound()        — non-blocking, fails silently
  → Haptics.impactAsync()               — gated on settings.hapticsEnabled
  → UI re-renders from context
```

Statistics are always calculated on-the-fly from the raw event log, never stored as aggregates. This ensures correctness after undo/correction without requiring any cache invalidation.

## Accessibility

- All interactive elements carry `accessibilityRole`, `accessibilityLabel`, and where helpful, `accessibilityHint`
- `NumberButton` respects `settings.reducedMotion` — the press animation is skipped entirely
- Touch targets are a minimum of 44×44pt
- The dark theme maintains high contrast ratios; no information is conveyed by color alone (player colors are always accompanied by names)

## Sound

Audio assets are WAV files (22 kHz, mono, 16-bit PCM) in `assets/sounds/`. The `SoundService` caches loaded `Audio.Sound` instances and rewinds them before each play so rapid taps don't queue. All playback is wrapped in try/catch and gated on `settings.soundEnabled`.

## Future Extensibility

- **Cloud sync:** Replace storage calls in `GameContext` with an API client; AsyncStorage becomes a local cache with conflict resolution
- **Bluetooth input:** Implement the `RollSource = 'bluetooth'` path in `rollInput.ts`
- **Friend groups:** Add a `userId` field to `Player` and `GameSession`; sync becomes a filter/merge operation
- **Premium analytics:** Stats module is pure functions — new packs are additional exports with no coupling to core
- **Light theme:** Both color keys in `constants/colors.ts` currently use the dark palette; replace the `light` values to enable adaptive theming

## Portability

The project has zero Replit-specific runtime dependencies. It can be:
1. Cloned from GitHub
2. Installed with `pnpm install`
3. Run with `pnpm --filter @workspace/dice-tracker run dev`
4. Continued with Claude Code without restructuring

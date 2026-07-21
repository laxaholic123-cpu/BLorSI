---
name: Phase 1 Foundation — dice-tracker
description: Key decisions and patterns established in Phase 1 that future phases must follow.
---

# Phase 1 Foundation — dice-tracker

## AsyncStorage key schema
- Prefix: `blosi:` for all keys
- Schema version: `blosi:schema_version` → integer (currently 1)
- Session index: `blosi:session_ids` → string[] newest-first
- Active session: `blosi:active_session_id` → string | null
- Per-session: `blosi:session:{id}`, `blosi:rolls:{id}`, `blosi:exposures:{id}`
- All reads/writes wrapped in try/catch — storage failure is non-fatal

**Why:** Avoids collisions, enables selective clear, schema versioning without SQLite overhead.

## Immutable roll events
Roll events are never overwritten. Undo = set `deletedAt`. Correction = new event with `correctionOfEventId`.

**Why:** Full audit trail; cloud sync conflict resolution; spec requirement.

## UUID generation
`Date.now().toString(36) + Math.random().toString(36).substring(2, 11)`

**Why:** `uuid` package crashes on some Expo Go versions; `expo-crypto` v15 has known Expo Go crashes. No native crypto needed at tabletop scale.

## Dark-only theme
Both `light` and `dark` keys in `constants/colors.ts` point to the same dark charcoal + amber palette. `useColors()` returns `{ ...palette, radius: colors.radius }` — simplified to `scheme === 'dark' ? colors.dark : colors.light`.

**Why:** App always renders dark; system-aware hook is wired for future light theme.

## No backend
This is a pure local app. Do NOT import from `@workspace/api-client-react` or call any server. All state is AsyncStorage + React context.

## Navigation routes
- `/` → Home (tabs/index)
- `/history` → History tab
- `/settings` → Settings tab
- `/new-game` → modal stack (new-game/_layout.tsx + sub-pages)
- `/active-game` → full-screen, gestureEnabled: false
- `/results` → results screen

## Context pattern
`GameContext` = active session + roll events in memory, writes through to AsyncStorage.
`SettingsContext` = AppSettings in memory, persists on every change.
Both providers wrap the root layout in: `SettingsProvider > GameProvider`.

## GitHub push auth
GitHub push fails with auth error — the token from the GitHub setup task needs to be re-configured via `git remote set-url origin https://<token>@github.com/laxaholic123-cpu/BLorSI.git`. Local commits succeed.

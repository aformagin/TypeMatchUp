# Type Match Up — Agent Handoff Guide

## Purpose

Type Match Up is a Windows Electron desktop app for building a six-Pokémon party, checking defensive type matchups, reviewing move-type coverage, and editing Pokémon Champions builds.

## Architecture

| Area | Location | Responsibility |
| --- | --- | --- |
| Electron main process | `src/main.js` | SQLite schema/migrations, PokéAPI caching, Showdown parsing, analysis, IPC |
| Renderer bridge | `src/preload.js` | Narrow `window.teamApi` IPC surface |
| UI | `src/renderer/index.html` | Dashboard and modals |
| UI behavior | `src/renderer/renderer.js` | Rendering, modal state, Champions stat previews |
| Styling | `src/renderer/styles.css` | 1080p compact layout and modal/card styles |
| Packaging | `package.json` | Electron Builder portable Windows output |

Keep database and network operations in `main.js`. Preserve context isolation and do not enable Node integration in the renderer.

## Current features

- Individual Pokémon lookup and local six-slot party persistence.
- Standard Pokémon Showdown import, including nickname/species, held item, moves, nature, and EV conversion.
- Cached Pokémon, move, and type-chart data in local SQLite.
- Shared and individual defensive weaknesses, type suggestions, and move-type coverage.
- Full defensive matchup map in a modal.
- Per-Pokémon modal opened by clicking a filled party card.
- Editable Pokémon Champions nature and Stat Points build sheet.

## Pokémon Champions stat rules

- Calculate stats at level 50.
- IVs are fixed at 31 and are not editable.
- Stat Points (SPs) replace EV allocation.
- Allow at most 66 SPs total and 32 SPs in any stat.
- Convert Showdown `EVs:` to the closest SP allocation with `showdownEvsToSps`; intentionally ignore `IVs:` lines.

The related source-of-truth constants are `STAT_KEYS`, `DEFAULT_SPS`, `NATURE_NAMES`, and `SHOWDOWN_STAT_KEYS` in `src/main.js`. Nature effects also exist in `src/renderer/renderer.js`; update both sides together if changing stat behavior.

## Database

- Location: `app.getPath('userData')/type-match-up.db`.
- User-data tables: `team_members`, `saved_teams`, `saved_team_members`, `pokemon_cache`, `type_cache`, and `move_cache`.
- Bundled read-only catalog: `src/data/encounters.sqlite` (`games`, `areas`, `encounters`, `catalog_meta`). Keep the SQLite file unpacked in Electron builds. Rebuild using `scripts/build-encounter-catalog.py` and the revision in `src/data/SOURCE.json`.
- Apply additive migrations through `openDatabase()` and `ensureColumn()`.
- Preserve existing party data and caches; do not remove or rename persisted columns without a migration.

## Commands

Run from the repository root:

```powershell
# Install dependencies; the postinstall hook rebuilds native Electron dependencies.
npm install

# Run locally.
npm start

# Rebuild better-sqlite3 for Electron's Node ABI.
npm run rebuild:native

# Full build: locked dependencies, mandatory pinned data scripts, checks, packaging.
.\build.ps1

# Repeat a full build with existing node_modules.
.\build.ps1 -SkipInstall

# Packaging only (does not regenerate data).
npm run package:win

# Syntax smoke checks.
node --check src\main.js
node --check src\preload.js
node --check src\renderer\renderer.js
```

The portable build is written to `portable-dist/`. It packages Electron, so the resulting executable is intentionally large and does not require an installer.

## Native module troubleshooting

If launch fails with a `NODE_MODULE_VERSION` or `better_sqlite3.node` mismatch, rebuild the native dependency:

```powershell
npm run rebuild:native
```

This runs Electron Builder's `install-app-deps` workflow. On a clean computer it may require permission to write Electron headers in the user profile.

## Validation checklist

`npm run verify` runs Electron/SQLite/renderer integration checks with isolated temporary user data. Before handoff:

1. Run every `node --check` command above.
2. Verify individual lookup, Showdown import, party removal, and analysis refresh in the app.
3. Open a party card, edit nature/SPs, save, and verify the result persists after reopening it.
4. Verify saved-team save/load/overwrite/delete, assignments, and the routes/encounters browser (including games without source data).
5. If packaging changes, run `npm run package:win` and confirm the new `.exe` is in `portable-dist/`.

## Product constraints

- Preserve the one-row party layout and compact 1080p dashboard.
- Keep the detailed matchup grid inside its modal to retain readability.
- Keep party cards vertically standardized for names, types, items, and moves.
- Showdown import replaces the current party; retain clear UI language about that behavior.
- Defensive analysis is typing-only; move coverage is type-chart-only. Do not claim support for abilities, move power, STAB, held-item mechanics, weather, status, Terastallization, Mega Evolution, or other battle effects.

## PokéAPI

PokéAPI v2 is read-only and unauthenticated. The app uses `/pokemon/{name}`, `/move/{name}`, and `/type/{name}`. Cache all fetched data locally and avoid repeated/bulk API calls.

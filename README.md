# Type Match Up

A Windows Electron desktop app for building a six-Pokémon party, identifying defensive type gaps, reviewing offensive move-type coverage, and managing Pokémon Champions (and other games) builds. It uses PokéAPI v2 for Pokémon, move, and type-chart data, then caches the results in a local SQLite database.

## Scope note

Defensive analysis evaluates Pokémon typing only. Move coverage evaluates move types against the standard type chart. The app does not currently model abilities, move power, STAB, held-item mechanics, weather, status, Terastallization, Mega Evolution, or other battle effects.

## What it does

- Looks up Pokémon names and their one or two types from [PokéAPI v2](https://pokeapi.co/docs/v2).
- Persists up to six party slots in a local SQLite database stored in Electron's user-data folder.
- Caches Pokémon, base stats, move types, and all 18 type damage-relation responses locally, respecting PokéAPI's caching guidance.
- Shows shared defensive weaknesses, individual exposures, defensive type suggestions, and a full weakness/resistance/immunity map in a detail modal.
- Imports standard Pokémon Showdown team exports (up to six sets), saving each set's held item, moves, and nature.
- Converts imported Showdown EV spreads to the closest Pokémon Champions Stat Point allocation.
- Maps imported move types to defending types the party can hit super-effectively, including uncovered types.
- Opens a Champions build sheet when a party card is clicked: base stats, calculated level-50 stats, nature, imported moves, and editable Stat Points.
- Saves multiple named team snapshots with optional game or generation assignments; includes a searchable, scrollable modal to load, overwrite, or delete snapshots.
- Adds a **Game Routes & Encounters** tab with searchable games and locations, method filters, Pokémon/condition search, levels, and encounter-slot rates.
- Includes an offline SQLite encounter catalog from PokéAPI's published dataset (53 games/versions listed, 41 with encounter records). Games without records show an explicit data-unavailable state.
- Uses a compact, Switch-inspired 1080p desktop layout.

## Pokémon Champions stat model

The build sheet follows the Pokémon Champions Stat Point model:

- Pokémon are calculated at level 50.
- IVs are fixed at 31 and are not editable.
- Stat Points (SPs) replace traditional EV allocation.
- Allocate at most 66 SPs total, with at most 32 SPs in a single stat.

Showdown `EVs:` are converted to the nearest Champions SP allocation on import. Showdown `IVs:` are intentionally ignored.

## Run locally

```powershell
npm install
npm start
```

The first team analysis downloads the type chart. Move types, base stats, the chart, and looked-up Pokémon are then available from the local cache.

If Electron reports a `NODE_MODULE_VERSION` or `better-sqlite3` mismatch, rebuild the native SQLite module for Electron:

```powershell
npm run rebuild:native
```

## Build a portable executable

Install Node.js/npm and Python 3.9+ (including its standard SQLite module), then run:

```powershell
.\build.ps1
```

The script works from any current directory when invoked by its path. It stops on any failed command and returns a nonzero exit code. Network access is required for dependency installation, the pinned PokéAPI dataset, and uncached integration-test lookups.

It installs dependencies with `npm ci --include=dev` (including the native Electron rebuild), always runs `scripts/build-encounter-catalog.py` using the pinned revision in `src/data/SOURCE.json`, validates the generated catalog, checks JavaScript syntax, runs isolated app integration checks, builds the portable executable, and tests the packaged archive and unpacked SQLite catalog/native module. Test data uses temporary folders, preserving your normal party database.

For subsequent builds with dependencies already installed:

```powershell
.\build.ps1 -SkipInstall
```

This reuses `node_modules` and still rebuilds native dependencies, regenerates/validates the catalog, runs checks, and packages the app. It does not skip mandatory data scripts.

The final executable is written to `portable-dist/Type Match Up <version>.exe`. The script checks that it exists and was freshly built. It does not install the app or create shortcuts. Lower-level `npm run package:win` and `npm run package:portable` commands only package the current source/data; use `build.ps1` for the complete workflow.

## Local data and API behavior

- Local database: `type-match-up.db` in Electron's user-data directory. Existing parties and caches are preserved through additive migrations.
- `team_members` holds the autosaved current party; `saved_teams` and `saved_team_members` hold independent snapshots with game/generation assignments. Loading a snapshot replaces the current party. Later edits change the current party until you explicitly overwrite the snapshot.
- Pokémon, type, and move caches remain in SQLite; there is no localStorage or separate JSON user-state store.
- The read-only catalog `src/data/encounters.sqlite` contains game, area, and encounter tables. It is unpacked alongside the app in portable builds so SQLite can open it. Browsing makes no API requests.
- PokéAPI endpoints: `/pokemon/{name}`, `/move/{name}`, and `/type/{name}`.
- The app needs network access only for uncached Pokémon, move, or type data.

## Encounters and dataset maintenance

The catalog uses the [official PokéAPI CSV dataset](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv). The pinned revision and rebuild command are recorded in `src/data/SOURCE.json`; the upstream license is included in `src/data/POKEAPI-LICENSE.txt`.

Rates are shown **per encounter slot**, under each listed method and condition, rather than per step. A Pokémon can appear in several slots with different levels or conditions. Alternative time, weather, swarm, and other conditions must not be added together. Missing rates appear as a dash. Dataset coverage can be partial even for a listed game; absent records do not establish that encounters are impossible. Game assignments are organizational labels and do not change the current typing-only analysis or Champions stat model.

To rebuild the catalog using the recorded revision (Python 3 standard library only):

```powershell
python scripts/build-encounter-catalog.py 6fd69dfe90465ba96534f6816fc817737d1f97f6
```

Omit the SHA to fetch the latest upstream revision. Only this maintenance script downloads the bulk CSV data; the application browses its bundled SQLite tables offline.

## Verification

```powershell
node --check src/main.js
node --check src/preload.js
node --check src/renderer/renderer.js
npm run verify
```

The integration check uses real Electron, SQLite, preload IPC, and the renderer DOM with a fresh temporary user-data directory. It verifies legacy migration, individual lookup, Showdown import, removal and analysis, build persistence, saved-team operations, game/route queries, encounter rates and filters, and page-reload persistence. Uncached lookup/analysis checks require network access. Screenshots are saved under `verification/` (ignored by Git). Your normal user-data database is never used. After packaging, test the archive and its unpacked native module/catalog with:

```powershell
node scripts/run-verification.cjs --packaged-resources=portable-dist/win-unpacked/resources
```

## AI Assist Usage Disclaimer 

As with most projects nowadays, this project utilized agentic AI tools to assist in development and testing of this tool. This project is **not** "vibe-coded", instead makes use of "Agentic Engineering", where all choices and implementations have had a human operator dedicate time into designing, writing, editing and reviewing code.
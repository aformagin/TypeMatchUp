const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

const POKE_API = 'https://pokeapi.co/api/v2';
const TYPE_NAMES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark',
  'steel', 'fairy'
];

const STAT_KEYS = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
const DEFAULT_SPS = Object.fromEntries(STAT_KEYS.map(key => [key, 0]));
const NATURE_NAMES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
  'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'
];

const SHOWDOWN_STAT_KEYS = { HP: 'hp', Atk: 'attack', Def: 'defense', SpA: 'special-attack', SpD: 'special-defense', Spe: 'speed' };

let db;
let catalog;

/* 
  * The following tables need to be created for storing saved teams, team members, and etc.
  * Tables:
  * saved_teams, saved_team_members, team_members,
  * pokemon_cache, type_cache, move_cache
  */
function openDatabase() {
  db = new Database(path.join(app.getPath('userData'), 'type-match-up.db'));
 
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_teams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      game_id INTEGER,
      generation INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS saved_team_members (
      team_id INTEGER NOT NULL REFERENCES saved_teams(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 6),
      pokemon_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      types_json TEXT NOT NULL,
      sprite_url TEXT,
      item TEXT,
      moves_json TEXT NOT NULL DEFAULT '[]',
      stats_json TEXT NOT NULL DEFAULT '{}',
      nature TEXT NOT NULL DEFAULT 'Serious',
      sps_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (team_id, slot)
    );
    CREATE TABLE IF NOT EXISTS team_members (
      slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND 6),
      pokemon_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      types_json TEXT NOT NULL,
      sprite_url TEXT,
      item TEXT,
      moves_json TEXT NOT NULL DEFAULT '[]',
      stats_json TEXT NOT NULL DEFAULT '{}',
      nature TEXT NOT NULL DEFAULT 'Serious',
      sps_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pokemon_cache (
      pokemon_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      types_json TEXT NOT NULL,
      sprite_url TEXT,
      stats_json TEXT,
      cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS type_cache (
      name TEXT PRIMARY KEY,
      relations_json TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS move_cache (
      name TEXT PRIMARY KEY,
      type_name TEXT,
      cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn('team_members', 'item', 'TEXT');
  ensureColumn('team_members', 'moves_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('team_members', 'stats_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('team_members', 'nature', "TEXT NOT NULL DEFAULT 'Serious'");
  ensureColumn('team_members', 'sps_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('pokemon_cache', 'stats_json', 'TEXT');

  const catalogPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'data', 'encounters.sqlite')
    : path.join(__dirname, 'data', 'encounters.sqlite');

  catalog = new Database(catalogPath, { readonly: true, fileMustExist: true });
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(entry => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function memberFromRow(row) {
  return row && {
    ...row,
    types: JSON.parse(row.types_json),
    moves: row.moves_json ? JSON.parse(row.moves_json) : [],
    stats: row.stats_json ? JSON.parse(row.stats_json) : {},
    nature: row.nature || 'Serious',
    sps: { ...DEFAULT_SPS, ...(row.sps_json ? JSON.parse(row.sps_json) : {}) }
  };
}

function getTeam() {
  const rows = db.prepare('SELECT * FROM team_members ORDER BY slot').all();
  
  return rows.map(memberFromRow);
}

// The bundled catalog is immutable; user parties and snapshots stay in userData.
function getGames() {
  return catalog.prepare(`SELECT g.*, EXISTS(SELECT 1 FROM encounters e WHERE e.game_id = g.id) AS has_encounters
    FROM games g ORDER BY generation, id`).all().map(game => ({
      ...game,
      label: ['red-japan', 'blue-japan', 'green-japan'].includes(game.name) ? `${game.label} (Japan)` : game.label
    }));
}

function requireId(value, label) {
  const id = Number(value);
  
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Choose a valid ${label}.`);
  
  return id;
}

function getRoutes(gameId) {
  const id = requireId(gameId, 'game');
  
  if (!catalog.prepare('SELECT 1 FROM games WHERE id = ?').get(id)) throw new Error('That game is unavailable.');
  
  return catalog.prepare(`SELECT a.location_id AS id, a.location_name AS name, COUNT(DISTINCT a.id) AS area_count
    FROM areas a JOIN encounters e ON e.area_id = a.id WHERE e.game_id = ?
    GROUP BY a.location_id, a.location_name ORDER BY a.location_name`).all(id)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

function getEncounters({ gameId, routeId }) {
  return catalog.prepare(`SELECT a.id AS area_id, a.name AS area, e.pokemon, e.method, e.conditions,
      e.min_level, e.max_level, e.chance
    FROM encounters e JOIN areas a ON a.id = e.area_id
    WHERE e.game_id = ? AND a.location_id = ?
    ORDER BY a.name, e.method, e.conditions, e.pokemon, e.min_level, e.max_level, e.chance DESC`)
    .all(requireId(gameId, 'game'), requireId(routeId, 'route'));
}

function getSavedTeams() {
  const games = new Map(getGames().map(game => [game.id, game]));
  
  return db.prepare('SELECT * FROM saved_teams ORDER BY updated_at DESC, id DESC').all().map(saved => ({
    ...saved,
    game: games.get(saved.game_id)?.label || null,
    members: db.prepare('SELECT * FROM saved_team_members WHERE team_id = ? ORDER BY slot').all(saved.id).map(memberFromRow)
  }));
}

function saveTeamSnapshot({ id, name, gameId, generation }) {
  const title = String(name || '').trim();
  
  if (!title || title.length > 80) throw new Error('Enter a team name of up to 80 characters.');
  const game = gameId ? catalog.prepare('SELECT * FROM games WHERE id = ?').get(requireId(gameId, 'game')) : null;
  
  if (gameId && !game) throw new Error('Choose a valid game.');
  const chosenGeneration = game ? game.generation : (generation ? Number(generation) : null);
 
  if (chosenGeneration !== null && !catalog.prepare('SELECT 1 FROM games WHERE generation = ?').get(chosenGeneration)) {
    throw new Error('Choose a valid generation.');
  }
  if (!getTeam().length) throw new Error('Add at least one Pokémon before saving a team.');
  
  return db.transaction(() => {
    let teamId;
    if (id) {
      teamId = requireId(id, 'saved team');
      const result = db.prepare(`UPDATE saved_teams SET name = ?, game_id = ?, generation = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(title, game?.id || null, chosenGeneration, teamId);
      if (!result.changes) throw new Error('That saved team no longer exists.');
      db.prepare('DELETE FROM saved_team_members WHERE team_id = ?').run(teamId);
    } else {
      teamId = Number(db.prepare('INSERT INTO saved_teams (name, game_id, generation) VALUES (?, ?, ?)')
        .run(title, game?.id || null, chosenGeneration).lastInsertRowid);
    }

    db.prepare(`INSERT INTO saved_team_members
      (team_id, slot, pokemon_id, name, types_json, sprite_url, item, moves_json, stats_json, nature, sps_json)
      SELECT ?, slot, pokemon_id, name, types_json, sprite_url, item, moves_json, stats_json, nature, sps_json FROM team_members`).run(teamId);
    
      return teamId;
  })();
}

function loadTeamSnapshot(id) {
  const teamId = requireId(id, 'saved team');
  
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM saved_teams WHERE id = ?').get(teamId)) throw new Error('That saved team no longer exists.');
    const members = db.prepare('SELECT * FROM saved_team_members WHERE team_id = ? ORDER BY slot').all(teamId).map(memberFromRow);
    
    if (!members.length) throw new Error('This saved team has no Pokémon.');
    db.prepare('DELETE FROM team_members').run();
    members.forEach(saveMember);
    
    return getTeam();
  })();
}
/* For edge-case Nidoran male and female, thanks Gamefreak. */
function normaliseName(value) {
  const aliases = { 'nidoran♀': 'nidoran-f', 'nidoran♂': 'nidoran-m' };
  const source = String(value || '').trim().toLowerCase();

  return aliases[source] || source.replace(/[.'’]/g, '').replace(/\s+/g, '-');
}

function displayName(name) {
  return name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  
  if (!response.ok) {
    if (response.status === 404) throw new Error('That Pokémon could not be found.');
    throw new Error(`PokéAPI could not complete the request (${response.status}).`);
  }

  return response.json();
}

async function findPokemon(rawName) {
  const name = normaliseName(rawName);
  if (!name) throw new Error('Enter a Pokémon name first.');

  const cached = db.prepare('SELECT * FROM pokemon_cache WHERE name = ?').get(name);
  if (cached?.stats_json) return memberFromRow(cached);

  const pokemon = await fetchJson(`${POKE_API}/pokemon/${encodeURIComponent(name)}`);
  const entry = {
    pokemon_id: pokemon.id,
    name: pokemon.name,
    types: pokemon.types.sort((a, b) => a.slot - b.slot).map(item => item.type.name),
    sprite_url: pokemon.sprites.other?.['official-artwork']?.front_default || pokemon.sprites.front_default || null,
    stats: Object.fromEntries(pokemon.stats.map(entry => [entry.stat.name, entry.base_stat]))
  };

  db.prepare(`INSERT INTO pokemon_cache (pokemon_id, name, types_json, sprite_url, stats_json)
    VALUES (@pokemon_id, @name, @types_json, @sprite_url, @stats_json)
    ON CONFLICT(name) DO UPDATE SET types_json = excluded.types_json, sprite_url = excluded.sprite_url, stats_json = excluded.stats_json, cached_at = CURRENT_TIMESTAMP`
  ).run({ ...entry, types_json: JSON.stringify(entry.types), stats_json: JSON.stringify(entry.stats) });
  
  return entry;
}

function parseShowdownImport(rawText) {
  const sets = String(rawText || '').trim().split(/\r?\n\s*\r?\n/).filter(Boolean);
  if (!sets.length) throw new Error('Paste one or more Showdown sets to import.');
  
  if (sets.length > 6) throw new Error('Showdown imports can contain up to six Pokémon.');

  return sets.map((set, index) => {
    const lines = set.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const header = lines[0] || '';
    const itemMatch = header.match(/\s@\s(.+)$/);
    const namePart = header.replace(/\s@\s.+$/, '').replace(/\s+\((?:M|F)\)$/i, '').trim();
    const speciesMatches = [...namePart.matchAll(/\(([^()]+)\)/g)].map(match => match[1]).filter(value => !/^(m|f)$/i.test(value));
    const name = speciesMatches.at(-1) || namePart;
    const moves = lines.filter(line => line.startsWith('-')).map(line => line.slice(1).trim()).filter(Boolean).slice(0, 4);
    const natureLine = lines.find(line => /\sNature$/i.test(line));
    
    if (!name) throw new Error(`Set ${index + 1} does not include a Pokémon name.`);
    
    return {
      name,
      item: itemMatch?.[1]?.trim() || null,
      moves,
      nature: NATURE_NAMES.find(nature => nature.toLowerCase() === natureLine?.replace(/\sNature$/i, '').trim().toLowerCase()) || 'Serious',
      sps: showdownEvsToSps(parseShowdownSpread(lines, 'EVs:', DEFAULT_SPS))
    };
  });
}

function parseShowdownSpread(lines, prefix, defaults) {
  const line = lines.find(entry => entry.startsWith(prefix));
  
  if (!line) return { ...defaults };
  
  const spread = { ...defaults };
  line.slice(prefix.length).trim().split('/').forEach(part => {
    const match = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (match) spread[SHOWDOWN_STAT_KEYS[match[2]]] = Number(match[1]);
  });
  
  return spread;
}

function showdownEvsToSps(evs) {
  return Object.fromEntries(STAT_KEYS.map(key => {
    const value = Number(evs[key]) || 0;
    const sps = value < 4 ? 0 : 1 + Math.floor((value - 4) / 8);
    
    return [key, Math.min(32, sps)];
  }));
}

function moveRequest(rawName) {
  const hiddenPower = String(rawName).match(/^hidden power\s*\[([a-z]+)\]$/i);
  let req;
  hiddenPower ? 
    req = { key: `hidden-power-${hiddenPower[1].toLowerCase()}`, apiName: 'hidden-power', typeOverride: hiddenPower[1].toLowerCase() } 
    :
    req = { key: normaliseName(rawName), apiName: normaliseName(rawName), typeOverride: null };
  
  return req;
}

async function getMoveInfo(rawName) {
  const request = moveRequest(rawName);
  
  if (request.typeOverride && TYPE_NAMES.includes(request.typeOverride)) return { name: rawName, type: request.typeOverride };
  
  const cached = db.prepare('SELECT type_name FROM move_cache WHERE name = ?').get(request.key);
  
  if (cached) return { name: rawName, type: cached.type_name };
  try {
    const move = await fetchJson(`${POKE_API}/move/${encodeURIComponent(request.apiName)}`);
    const type = move.type?.name || null;
    db.prepare(`INSERT INTO move_cache (name, type_name) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET type_name = excluded.type_name, cached_at = CURRENT_TIMESTAMP`
    ).run(request.key, type);
    return { name: rawName, type };
  } catch {
    return { name: rawName, type: null };
  }
}

async function getTypeRelations(typeName) {
  const cached = db.prepare('SELECT relations_json FROM type_cache WHERE name = ?').get(typeName);
  
  if (cached) return JSON.parse(cached.relations_json);
  
  const type = await fetchJson(`${POKE_API}/type/${typeName}`);
  const relations = type.damage_relations;
  
  db.prepare(`INSERT INTO type_cache (name, relations_json) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET relations_json = excluded.relations_json, cached_at = CURRENT_TIMESTAMP`
  ).run(typeName, JSON.stringify(relations));
  
  return relations;
}

function multiplierFor(attackType, defenderTypes, relations) {
  const names = new Set;
  let multiplier = 1;

  for (const defenderType of defenderTypes) {
    if (relations.double_damage_to.some(item => item.name === defenderType)) multiplier *= 2;
    else if (relations.half_damage_to.some(item => item.name === defenderType)) multiplier *= 0.5;
    else if (relations.no_damage_to.some(item => item.name === defenderType)) multiplier *= 0;
  }

  return multiplier;
}

function defenseMultiplier(attackType, candidateType, relations) {
  if (relations.double_damage_to.some(item => item.name === candidateType)) return 2;
  if (relations.half_damage_to.some(item => item.name === candidateType)) return 0.5;
  if (relations.no_damage_to.some(item => item.name === candidateType)) return 0;
  
  return 1;
}

async function analyzeTeam() {
  const team = getTeam();
  if (!team.length) return { team, matchups: [], holes: [], suggestions: [], moveCoverage: null };

  const moveNames = [...new Set(team.flatMap(member => member.moves || []))];
  const [relationEntries, moveInfos] = await Promise.all([
    Promise.all(TYPE_NAMES.map(async name => [name, await getTypeRelations(name)])),
    Promise.all(moveNames.map(getMoveInfo))
  ]);
  const relationsByAttack = Object.fromEntries(relationEntries);

  const matchups = TYPE_NAMES.map(attackType => {
    const outcomes = team.map(member => multiplierFor(attackType, member.types, relationsByAttack[attackType]));
    const weak = outcomes.filter(value => value > 1).length;
    const immune = outcomes.filter(value => value === 0).length;
    const resist = outcomes.filter(value => value > 0 && value < 1).length;
    
    return {
      attackType,
      weak,
      immune,
      resist,
      neutral: team.length - weak - immune - resist,
      weakMembers: team.filter((_member, index) => outcomes[index] > 1).map(member => member.name)
    };
  });

  const holes = matchups
    .filter(item => item.weak >= Math.max(2, Math.ceil(team.length / 3)))
    .map(item => ({ ...item, severity: item.weak >= Math.ceil(team.length / 2) ? 'critical' : 'watch' }))
    .sort((a, b) => b.weak - a.weak || a.attackType.localeCompare(b.attackType));

  const suggestions = TYPE_NAMES.map(candidateType => {
    const protection = holes.filter(hole => defenseMultiplier(hole.attackType, candidateType, relationsByAttack[hole.attackType]) < 1).length;
    const immunity = holes.filter(hole => defenseMultiplier(hole.attackType, candidateType, relationsByAttack[hole.attackType]) === 0).length;
    const newWeaknesses = holes.filter(hole => defenseMultiplier(hole.attackType, candidateType, relationsByAttack[hole.attackType]) > 1).length;
    
    return { type: candidateType, protection, immunity, newWeaknesses, score: protection * 3 + immunity * 2 - newWeaknesses * 2 };
  }).filter(item => item.protection > 0)
    .sort((a, b) => b.score - a.score || b.immunity - a.immunity || a.type.localeCompare(b.type))
    .slice(0, 4);

  const typedMoves = moveInfos.filter(move => move.type && TYPE_NAMES.includes(move.type));
  const availableTypes = [...new Set(typedMoves.map(move => move.type))];
  const strongAgainst = TYPE_NAMES.filter(defenderType => availableTypes.some(attackType =>
    relationsByAttack[attackType].double_damage_to.some(item => item.name === defenderType)
  ));
  const movesByType = availableTypes.map(type => ({ type, moves: typedMoves.filter(move => move.type === type).map(move => move.name) }));
  const moveCoverage = {
    moveCount: moveNames.length,
    movesByType,
    strongAgainst,
    uncovered: TYPE_NAMES.filter(type => !strongAgainst.includes(type)),
    unknownMoves: moveInfos.filter(move => !move.type).map(move => move.name)
  };

  return { team, matchups, holes, suggestions, moveCoverage };
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1020,
    minHeight: 700,
    backgroundColor: '#f6f7fb',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  openDatabase();

  ipcMain.handle('team:get', () => getTeam());
  ipcMain.handle('games:list', () => getGames());
  ipcMain.handle('routes:list', (_event, gameId) => getRoutes(gameId));
  ipcMain.handle('routes:encounters', (_event, payload) => getEncounters(payload));
  ipcMain.handle('saved-teams:list', () => getSavedTeams());
  ipcMain.handle('saved-teams:save', (_event, payload) => saveTeamSnapshot(payload));
  ipcMain.handle('saved-teams:load', (_event, id) => loadTeamSnapshot(id));
  ipcMain.handle('saved-teams:delete', (_event, id) => {
    db.prepare('DELETE FROM saved_teams WHERE id = ?').run(requireId(id, 'saved team'));
  });

  ipcMain.handle('team:details', async (_event, slot) => {
    const row = db.prepare('SELECT * FROM team_members WHERE slot = ?').get(Number(slot));
    if (!row) throw new Error('That Pokémon is no longer in your party.');
    const member = memberFromRow(row);
    if (Object.keys(member.stats).length) return member;
    const pokemon = await findPokemon(member.name);
    db.prepare('UPDATE team_members SET stats_json = ? WHERE slot = ?').run(JSON.stringify(pokemon.stats), member.slot);
    return memberFromRow(db.prepare('SELECT * FROM team_members WHERE slot = ?').get(member.slot));
  });

  ipcMain.handle('team:analysis', () => analyzeTeam());
  
  ipcMain.handle('team:add', async (_event, { name, slot }) => {
    const member = await findPokemon(name);
    const current = getTeam();
    const chosenSlot = (slot ? requireId(slot, 'party slot') : null) || [1, 2, 3, 4, 5, 6].find(number => !current.some(item => item.slot === number));
    if (!chosenSlot || chosenSlot < 1 || chosenSlot > 6) throw new Error('Your team already has six Pokémon.');
    saveMember({ ...member, slot: chosenSlot, item: null, moves: [], nature: 'Serious', sps: DEFAULT_SPS });
    return getTeam();
  });

  ipcMain.handle('team:import', async (_event, rawText) => {
    const sets = parseShowdownImport(rawText);
    const members = await Promise.all(sets.map(async (set, index) => ({
      ...await findPokemon(set.name), slot: index + 1, item: set.item, moves: set.moves, nature: set.nature, sps: set.sps
    })));
    db.transaction((importedMembers) => {
      db.prepare('DELETE FROM team_members').run();
      importedMembers.forEach(saveMember);
    })(members);
    return getTeam();
  });

  ipcMain.handle('team:update-build', (_event, { slot, nature, sps }) => {
    if (!NATURE_NAMES.includes(nature)) throw new Error('Choose a valid Pokémon nature.');
    const normalizedSps = normaliseSpread(sps, 32);
    const totalSps = Object.values(normalizedSps).reduce((total, value) => total + value, 0);
    if (totalSps > 66) throw new Error('Stat Points cannot exceed 66 in total.');
    const result = db.prepare(`UPDATE team_members SET nature = ?, sps_json = ?, updated_at = CURRENT_TIMESTAMP WHERE slot = ?`)
      .run(nature, JSON.stringify(normalizedSps), Number(slot));
    if (!result.changes) throw new Error('That Pokémon is no longer in your party.');
    return getTeam();
  });

  ipcMain.handle('team:remove', (_event, slot) => {
    db.prepare('DELETE FROM team_members WHERE slot = ?').run(Number(slot));
    return getTeam();
  });

  ipcMain.handle('team:clear', () => {
    db.prepare('DELETE FROM team_members').run();
    return getTeam();
  });

  createWindow();
  
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

function saveMember(member) {
  db.prepare(`INSERT INTO team_members (slot, pokemon_id, name, types_json, sprite_url, item, moves_json, stats_json, nature, sps_json)
    VALUES (@slot, @pokemon_id, @name, @types_json, @sprite_url, @item, @moves_json, @stats_json, @nature, @sps_json)
    ON CONFLICT(slot) DO UPDATE SET pokemon_id = excluded.pokemon_id, name = excluded.name, types_json = excluded.types_json, sprite_url = excluded.sprite_url, item = excluded.item, moves_json = excluded.moves_json, stats_json = excluded.stats_json, nature = excluded.nature, sps_json = excluded.sps_json, updated_at = CURRENT_TIMESTAMP`
  ).run({
    ...member,
    types_json: JSON.stringify(member.types),
    moves_json: JSON.stringify(member.moves || []),
    stats_json: JSON.stringify(member.stats || {}),
    nature: member.nature || 'Serious',
    sps_json: JSON.stringify({ ...DEFAULT_SPS, ...(member.sps || {}) })
  });
}

function normaliseSpread(spread, max) {
  return Object.fromEntries(STAT_KEYS.map(key => {
    const value = Number(spread?.[key]);
    return [key, Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0];
  }));
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('will-quit', () => { catalog?.close(); db?.close(); });

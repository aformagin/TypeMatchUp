// Integration checks run against an isolated temporary user-data directory.
// Uses real Electron, SQLite, preload IPC and renderer DOM; never opens the user's database.
const { app, BrowserWindow } = require('electron');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'type-match-up-verify-'));
const screenshots = path.join(__dirname, '..', 'verification');
const packagedResources = process.argv.find(arg => arg.startsWith('--packaged-resources='))?.split('=').slice(1).join('=');
if (packagedResources) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.resolve(packagedResources) });
}
app.setPath('userData', temporary);
// Simulate a database from before the existing stats/build migrations.
const legacy = new Database(path.join(temporary, 'type-match-up.db'));
legacy.exec(`CREATE TABLE team_members (slot INTEGER PRIMARY KEY, pokemon_id INTEGER NOT NULL,
  name TEXT NOT NULL, types_json TEXT NOT NULL, sprite_url TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  INSERT INTO team_members(slot,pokemon_id,name,types_json) VALUES(3,1,'bulbasaur','["grass","poison"]');`);
legacy.close();
let window;
const errors = [];
app.on('browser-window-created', (_event, created) => {
  window = created;
  window.hide();
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  window.webContents.once('did-finish-load', () => verify().catch(fail));
});
function page(code) { return window.webContents.executeJavaScript(code); }
function api(name, ...args) { return page(`window.teamApi[${JSON.stringify(name)}](...${JSON.stringify(args)})`); }
async function until(code) {
  for (let i = 0; i < 200; i++) {
    if (await page(code)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${code}. UI message: ${await page('document.querySelector("#form-message").textContent')}`);
}
async function screenshot(name) {
  await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.mkdirSync(screenshots, { recursive: true });
  fs.writeFileSync(path.join(screenshots, name + '.png'), (await window.webContents.capturePage()).toPNG());
}
async function verify() {
  assert.equal((await api('getTeam'))[0].slot, 3, 'legacy party preserved');
  await until('document.querySelector("#matchups").children.length === 18');
  const games = await api('getGames');
  assert(games.length >= 40);
  const red = games.find(game => game.name === 'red');
  const routes = await api('getRoutes', red.id);
  const route = routes.find(route => route.name === 'Route 1');
  assert(route, 'Red Route 1 present');
  const encounters = await api('getEncounters', { gameId: red.id, routeId: route.id });
  assert(encounters.some(entry => entry.pokemon === 'pidgey'));
  assert(encounters.every(entry => entry.chance === null || (entry.chance >= 0 && entry.chance <= 100)));
  assert.equal(encounters.filter(entry => entry.pokemon === 'pidgey').reduce((n, e) => n + e.chance, 0), 50);
  const noData = games.find(game => !game.has_encounters);
  assert.deepEqual(await api('getRoutes', noData.id), []);
  const legacyId = await api('saveTeam', { name: 'Legacy party', generation: 1 });
  await api('add', { name: 'pikachu' }); // Real individual lookup, native cache write.
  assert.equal((await api('getTeam')).length, 2);
  const detail = await api('getDetails', 1);
  assert(detail.stats.hp > 0);
  await api('importShowdown', 'Chompy (Garchomp) @ Leftovers\nEVs: 252 Atk / 4 Def / 252 Spe\nIVs: 0 Atk\nJolly Nature\n- Earthquake\n- Dragon Claw\n\nCharizard @ Heavy-Duty Boots\nModest Nature\n- Flamethrower');
  let team = await api('getTeam');
  assert.equal(team.length, 2);
  assert.equal(team[0].item, 'Leftovers');
  assert.equal(team[0].nature, 'Jolly');
  assert.equal(team[0].sps.attack, 32);
  const sps = { hp: 2, attack: 32, speed: 32 };
  await api('updateBuild', { slot: 1, nature: 'Adamant', sps });
  const id = await api('saveTeam', { name: 'Kanto & Sinnoh', gameId: red.id, generation: 9 });
  let saved = (await api('listSavedTeams')).find(team => team.id === id);
  assert.equal(saved.generation, 1, 'specific game determines generation');
  assert.equal(saved.members[0].nature, 'Adamant');
  assert.equal(saved.members[0].sps.attack, 32);
  await api('remove', 1);
  assert.equal((await api('analyze')).team.length, 1);
  assert.equal((await api('listSavedTeams')).find(team => team.id === id).members.length, 2, 'snapshot independent of active party');
  await api('loadTeam', id);
  assert.equal((await api('getDetails', 1)).sps.hp, 2, 'build persists on reopening');
  await assert.rejects(api('loadTeam', 999999));
  assert.equal((await api('getTeam')).length, 2, 'invalid load preserves party');
  await assert.rejects(api('saveTeam', { name: 'Bad generation', generation: 999 }));
  await api('clear');
  await assert.rejects(api('saveTeam', { name: 'Empty' }));
  await api('loadTeam', legacyId);
  assert.equal((await api('getTeam'))[0].slot, 3, 'snapshot preserves sparse slots');
  await api('saveTeam', { id: legacyId, name: 'Renamed', gameId: noData.id });
  assert.equal((await api('listSavedTeams')).find(team => team.id === legacyId).name, 'Renamed');
  await api('deleteTeam', legacyId);
  await assert.rejects(api('loadTeam', legacyId));
  await api('loadTeam', id);
  await page('refreshAnalysis()');
  // Verify the actual modal workflow and its persisted snapshot after a page reload.
  await page('document.querySelector("#open-saved-teams").click()');
  await until('document.querySelectorAll(".saved-team-card").length === 1');
  await page(`document.querySelector('#saved-team-name').value = 'UI saved team'; document.querySelector('#saved-team-generation').value = '5'; document.querySelector('#saved-team-generation').dispatchEvent(new Event('change')); document.querySelector('#save-team-form').requestSubmit()`);
  await until('document.querySelectorAll(".saved-team-card").length === 2');
  await screenshot('saved-teams');
  await page(`document.querySelector('#saved-team-search').value = 'UI saved'; document.querySelector('#saved-team-search').dispatchEvent(new Event('input'))`);
  assert.equal(await page('document.querySelectorAll(".saved-team-card").length'), 1, 'saved team search works');
  await page(`document.querySelector('#saved-team-search').value = ''; document.querySelector('#saved-team-search').dispatchEvent(new Event('input'))`);
  await page(`document.querySelector('[data-team-id="${id}"] [data-action="load"]').click()`);
  await until('!document.querySelector("#saved-teams-modal").open');
  await until('document.querySelector("#form-message").textContent.includes("Loaded")');
  assert.equal((await api('getTeam'))[0].nature, 'Adamant', 'modal load restores saved build');
  await page('document.querySelector("#open-saved-teams").click()');
  await until('document.querySelectorAll(".saved-team-card").length === 2');
  await page(`document.querySelector('[data-team-id="${id}"] [data-action="edit"]').click()`);
  assert.equal(await page('document.querySelector("#save-team-submit").textContent'), 'Overwrite saved team');
  await page('document.querySelector("#cancel-team-edit").click()');
  assert.equal(await page('document.querySelector("#save-team-submit").textContent'), 'Save new team');
  await page('document.querySelector("#close-saved-teams").click()');
  await screenshot('team-builder');
  await page('document.querySelector("#routes-tab").click()');
  await page(`document.querySelector('[data-game-id="${red.id}"]').click()`);
  await until('document.querySelectorAll("[data-route-id]").length > 0');
  await page(`document.querySelector('[data-route-id="${route.id}"]').click()`);
  await until('document.querySelectorAll(".encounter-table tbody tr").length > 0');
  await screenshot('encounters');
  const sword = games.find(game => game.name === 'sword');
  const swordRoutes = await api('getRoutes', sword.id);
  const wildArea = swordRoutes.find(route => route.name === 'Rolling Fields') || swordRoutes[0];
  const wildEncounters = await api('getEncounters', { gameId: sword.id, routeId: wildArea.id });
  assert(wildEncounters.some(entry => entry.conditions), 'conditional encounters retained');
  await page(`document.querySelector('#encounter-search').value = 'pidgey'; document.querySelector('#encounter-search').dispatchEvent(new Event('input'))`);
  assert(await page(`Array.from(document.querySelectorAll('.encounter-table tbody tr')).every(row => row.textContent.includes('Pidgey'))`));
  await page(`document.querySelector('[data-game-id="${noData.id}"]').click()`);
  await until('document.querySelector("#encounter-results").textContent.includes("no encounter records")');
  await page('document.querySelector("#team-tab").click(); document.querySelector(".filled-slot").click()');
  await until('document.querySelector("#pokemon-modal").open');
  await page(`document.querySelector('#nature-select').value = 'Jolly'; document.querySelector('#sp-hp').value = '1'; document.querySelector('#pokemon-build-form').requestSubmit()`);
  await until('!document.querySelector("#pokemon-modal").open');
  assert.equal((await api('getDetails', 1)).nature, 'Jolly');
  assert.equal((await api('getDetails', 1)).sps.hp, 1);
  // A full current-party row remains separate from saved snapshots.
  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await reloaded;
  await until('document.querySelector("#matchups").children.length === 18');
  assert.equal((await api('listSavedTeams')).length, 2, 'saved teams persist after reload');
  assert.equal((await api('getDetails', 1)).nature, 'Jolly');
  window.setSize(1920, 1080);
  await screenshot('team-builder-1080p');
  await page('document.querySelector("#routes-tab").click()');
  await page(`document.querySelector('[data-game-id="${sword.id}"]').click()`);
  await until('document.querySelectorAll("[data-route-id]").length > 0');
  await page(`document.querySelector('[data-route-id="${wildArea.id}"]').click()`);
  await until('document.querySelectorAll(".encounter-table tbody tr").length > 0');
  const methodCount = await page('document.querySelector("#encounter-method").options.length');
  assert(methodCount > 1);
  await page(`document.querySelector('#encounter-method').selectedIndex = 1; document.querySelector('#encounter-method').dispatchEvent(new Event('change'))`);
  assert(await page(`document.querySelectorAll('.encounter-table tbody tr').length < ${wildEncounters.length}`), 'method filter narrows results');
  await screenshot('conditional-encounters-1080p');
  assert(await page('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal page overflow');
  const check = new Database(path.join(temporary, 'type-match-up.db'));
  assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(check.prepare('SELECT COUNT(*) AS count FROM saved_team_members WHERE team_id = ?').get(legacyId).count, 0, 'delete cascades');
  assert(check.prepare('SELECT COUNT(*) AS count FROM pokemon_cache').get().count >= 3);
  check.close();
  assert.deepEqual(errors.filter(error => !error.includes('net::ERR_')), [], 'no renderer errors');
  console.log('PASS: migration, lookups, Showdown, analysis, builds, saved teams, routes, rates, filters and reload persistence.');
  console.log('Screenshots: ' + screenshots);
  app.quit();
}
function fail(error) { console.error(error); app.exit(1); }
process.on('uncaughtException', fail);
require(packagedResources ? path.join(process.resourcesPath, 'app.asar', 'src', 'main.js') : '../src/main.js');

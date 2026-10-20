const typeClass = (type) => `type-${type}`;
const titleCase = (value) => value.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
const STAT_DEFS = [
  ['hp', 'HP'], ['attack', 'Attack'], ['defense', 'Defense'],
  ['special-attack', 'Sp. Atk'], ['special-defense', 'Sp. Def'], ['speed', 'Speed']
];
const NATURES = {
  Hardy: [], Lonely: ['attack', 'defense'], Brave: ['attack', 'speed'], Adamant: ['attack', 'special-attack'], Naughty: ['attack', 'special-defense'],
  Bold: ['defense', 'attack'], Docile: [], Relaxed: ['defense', 'speed'], Impish: ['defense', 'special-attack'], Lax: ['defense', 'special-defense'],
  Timid: ['speed', 'attack'], Hasty: ['speed', 'defense'], Serious: [], Jolly: ['speed', 'special-attack'], Naive: ['speed', 'special-defense'],
  Modest: ['special-attack', 'attack'], Mild: ['special-attack', 'defense'], Quiet: ['special-attack', 'speed'], Bashful: [], Rash: ['special-attack', 'special-defense'],
  Calm: ['special-defense', 'attack'], Gentle: ['special-defense', 'defense'], Sassy: ['special-defense', 'speed'], Careful: ['special-defense', 'special-attack'], Quirky: []
};

const elements = {
  form: document.querySelector('#pokemon-form'),
  name: document.querySelector('#pokemon-name'),
  showdownForm: document.querySelector('#showdown-form'),
  showdownText: document.querySelector('#showdown-text'),
  message: document.querySelector('#form-message'),
  grid: document.querySelector('#team-grid'),
  clear: document.querySelector('#clear-team'),
  count: document.querySelector('#team-count'),
  empty: document.querySelector('#empty-analysis'),
  content: document.querySelector('#analysis-content'),
  holes: document.querySelector('#holes'),
  suggestions: document.querySelector('#suggestions'),
  coverage: document.querySelector('#move-coverage'),
  coverageCount: document.querySelector('#coverage-count'),
  matchups: document.querySelector('#matchups'),
  matchupModal: document.querySelector('#matchup-modal'),
  openMatchups: document.querySelector('#open-matchups'),
  closeMatchups: document.querySelector('#close-matchups'),
  pokemonModal: document.querySelector('#pokemon-modal'),
  pokemonBuildForm: document.querySelector('#pokemon-build-form'),
  closePokemon: document.querySelector('#close-pokemon'),
  cancelBuild: document.querySelector('#cancel-build'),
  detailSprite: document.querySelector('#detail-sprite'),
  detailTitle: document.querySelector('#pokemon-modal-title'),
  detailTypes: document.querySelector('#detail-types'),
  detailMoves: document.querySelector('#detail-moves'),
  nature: document.querySelector('#nature-select'),
  natureEffect: document.querySelector('#nature-effect'),
  statEditor: document.querySelector('#stat-editor'),
  buildMessage: document.querySelector('#build-message')
};

let team = [];
let selectedMember = null;

elements.nature.innerHTML = Object.keys(NATURES).map(nature => `<option value="${nature}">${nature}</option>`).join('');

function setMessage(message = '', kind = '') {
  elements.message.textContent = message;
  elements.message.className = `form-message ${kind}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function typePills(types) {
  return types.map(type => `<span class="type-pill ${typeClass(type)}">${titleCase(type)}</span>`).join('');
}

function natureEffect(nature) {
  const [boost, drop] = NATURES[nature] || [];
  return boost ? `+${STAT_DEFS.find(entry => entry[0] === boost)[1]} · −${STAT_DEFS.find(entry => entry[0] === drop)[1]}` : 'Neutral nature';
}

function calculateChampionsStat(key, base, sp, nature) {
  if (key === 'hp') return Math.floor((2 * base + 31) / 2) + 60 + sp;
  const [boost, drop] = NATURES[nature] || [];
  const multiplier = key === boost ? 1.1 : key === drop ? 0.9 : 1;
  return Math.floor((Math.floor((2 * base + 31) / 2) + 5) * multiplier) + sp;
}

function renderStatEditor(member) {
  elements.statEditor.innerHTML = STAT_DEFS.map(([key, label]) => {
    const base = member.stats[key] || 0;
    const sp = member.sps[key] || 0;
    const finalStat = calculateChampionsStat(key, base, sp, member.nature);
    return `<div class="stat-row" data-stat-row="${key}" role="row"><span>${label}</span><span>${base}</span><label class="sr-only" for="sp-${key}">${label} Stat Points</label><input id="sp-${key}" data-sp-stat="${key}" type="number" min="0" max="32" value="${sp}" inputmode="numeric" /><output data-final-stat="${key}">${finalStat}</output></div>`;
  }).join('');
  elements.natureEffect.textContent = natureEffect(member.nature);
}

function getCurrentSps() {
  return Object.fromEntries(STAT_DEFS.map(([key]) => [key, Number(elements.statEditor.querySelector(`[data-sp-stat="${key}"]`)?.value) || 0]));
}

function refreshStatPreviews() {
  if (!selectedMember) return;
  const sps = getCurrentSps();
  const nature = elements.nature.value;
  STAT_DEFS.forEach(([key]) => {
    const output = elements.statEditor.querySelector(`[data-final-stat="${key}"]`);
    if (output) output.textContent = calculateChampionsStat(key, selectedMember.stats[key] || 0, sps[key], nature);
  });
  const total = Object.values(sps).reduce((sum, value) => sum + value, 0);
  elements.natureEffect.textContent = `${natureEffect(nature)} · ${total} / 66 SP`;
  elements.buildMessage.textContent = total > 66 ? 'Stat Point total cannot exceed 66.' : '';
  elements.buildMessage.className = `build-message ${total > 66 ? 'error' : ''}`;
}

async function openPokemonModal(member) {
  try {
    selectedMember = await window.teamApi.getDetails(member.slot);
    elements.detailTitle.textContent = titleCase(selectedMember.name);
    elements.detailTypes.innerHTML = typePills(selectedMember.types);
    elements.detailSprite.innerHTML = selectedMember.sprite_url ? `<img src="${selectedMember.sprite_url}" alt="${escapeHtml(titleCase(selectedMember.name))}" />` : '';
    elements.detailMoves.innerHTML = selectedMember.moves.length
      ? selectedMember.moves.map(move => `<li>${escapeHtml(move)}</li>`).join('') : '<li class="no-moves">No imported moves</li>';
    elements.nature.value = selectedMember.nature;
    elements.buildMessage.textContent = '';
    renderStatEditor(selectedMember);
    refreshStatPreviews();
    elements.pokemonModal.showModal();
  } catch (error) {
    setMessage(error.message || 'Unable to load Pokémon details.', 'error');
  }
}

function renderTeam() {
  elements.grid.innerHTML = '';
  for (let slot = 1; slot <= 6; slot += 1) {
    const member = team.find(item => item.slot === slot);
    const card = document.createElement('article');
    card.className = `pokemon-slot ${member ? 'filled-slot' : 'empty-slot'}`;
    if (!member) {
      card.innerHTML = `<span class="slot-number">${slot}</span><div class="empty-plus">+</div><p>Open slot</p>`;
      card.addEventListener('click', () => elements.name.focus());
    } else {
      card.innerHTML = `
        <span class="slot-number">${slot}</span>
        <button class="remove-button" type="button" aria-label="Remove ${titleCase(member.name)}">×</button>
        <div class="sprite-wrap">${member.sprite_url ? `<img src="${member.sprite_url}" alt="${escapeHtml(titleCase(member.name))}" />` : ''}</div>
        <div class="pokemon-info">
          <h3>${escapeHtml(titleCase(member.name))}</h3>
          <div class="type-pills">${typePills(member.types)}</div>
          ${member.item ? `<p class="item-line" title="Held item">◈ ${escapeHtml(member.item)}</p>` : ''}
          ${member.moves?.length ? `<div class="move-list">${member.moves.map(move => `<span title="${escapeHtml(move)}">${escapeHtml(move)}</span>`).join('')}</div>` : ''}
        </div>`;
      card.querySelector('.remove-button').addEventListener('click', async () => {
        try { team = await window.teamApi.remove(slot); await refreshAnalysis(); setMessage(`${titleCase(member.name)} removed.`, 'success'); }
        catch (error) { setMessage(error.message, 'error'); }
      });
      card.querySelector('.remove-button').addEventListener('click', (event) => event.stopPropagation());
      card.addEventListener('click', () => openPokemonModal(member));
    }
    elements.grid.append(card);
  }
  elements.count.textContent = `${team.length} / 6`;
  elements.clear.disabled = team.length === 0;
}

function summaryChip(item, mode) {
  const labels = { weak: 'weak', resist: 'resist', immune: 'immune' };
  return item[mode] ? `<span class="summary ${mode}"><b>${item[mode]}</b> ${labels[mode]}</span>` : '';
}

function renderAnalysis(report) {
  const hasTeam = report.team.length > 0;
  elements.empty.hidden = hasTeam;
  elements.content.hidden = !hasTeam;
  if (!hasTeam) return;

  const sharedHoles = report.holes.length
    ? report.holes.map(hole => `<div class="hole-card ${hole.severity}"><span class="type-pill ${typeClass(hole.attackType)}">${titleCase(hole.attackType)}</span><strong>${hole.weak} of ${report.team.length}</strong><span>team members are weak</span></div>`).join('')
    : '<div class="all-clear"><span>✓</span><div><strong>Balanced defense</strong><p>No shared weaknesses detected yet.</p></div></div>';
  const individualExposures = report.matchups.filter(item => item.weak === 1);
  const individualWeaknesses = individualExposures.length ? `
    <div class="individual-exposures">
      <p>Individual exposures <span>(${individualExposures.length})</span></p>
      <div>${individualExposures.map(item => `<span class="exposure"><span class="type-pill ${typeClass(item.attackType)}">${titleCase(item.attackType)}</span><small>${titleCase(item.weakMembers[0])}</small></span>`).join('')}</div>
    </div>` : '';
  elements.holes.innerHTML = `${sharedHoles}${individualWeaknesses}`;

  elements.suggestions.innerHTML = report.suggestions.length
    ? report.suggestions.map((suggestion, index) => `<div class="suggestion-card"><span class="rank">0${index + 1}</span><span class="type-pill ${typeClass(suggestion.type)}">${titleCase(suggestion.type)}</span><p>Protects against <b>${suggestion.protection}</b> pressure point${suggestion.protection === 1 ? '' : 's'}${suggestion.immunity ? ` · ${suggestion.immunity} immunity` : ''}</p></div>`).join('')
    : '<div class="all-clear"><span>✓</span><div><strong>No obvious patch needed</strong><p>Keep evaluating when you add more members.</p></div></div>';

  renderMoveCoverage(report.moveCoverage);

  elements.matchups.innerHTML = report.matchups.map(item => `
    <div class="matchup-row">
      <span class="type-pill ${typeClass(item.attackType)}">${titleCase(item.attackType)}</span>
      <div class="summary-list">${summaryChip(item, 'weak')}${summaryChip(item, 'resist')}${summaryChip(item, 'immune') || '<span class="summary neutral"><b>—</b> immune</span>'}</div>
    </div>`).join('');
}

function renderMoveCoverage(coverage) {
  if (!coverage || coverage.moveCount === 0) {
    elements.coverageCount.textContent = 'Import moves to analyze';
    elements.coverage.innerHTML = '<div class="all-clear"><span>+</span><div><strong>No moves recorded</strong><p>Import a Pokémon Showdown team to map offensive coverage.</p></div></div>';
    return;
  }

  elements.coverageCount.textContent = `${coverage.strongAgainst.length} / 18 types covered`;
  const availableMoveTypes = coverage.movesByType.map(group =>
    `<span class="type-pill ${typeClass(group.type)}" title="${escapeHtml(group.moves.join(', '))}">${titleCase(group.type)}</span>`
  ).join('');
  const unknown = coverage.unknownMoves.length
    ? `<p class="coverage-warning">Couldn’t classify: ${coverage.unknownMoves.map(escapeHtml).join(', ')}.</p>` : '';
  elements.coverage.innerHTML = `
    <div class="coverage-moves"><span>Move types in your party</span><div class="type-pills">${availableMoveTypes}</div></div>
    <div class="coverage-targets"><span>Super-effective against</span><div class="type-pills">${typePills(coverage.strongAgainst)}</div></div>
    ${coverage.uncovered.length ? `<p class="coverage-gap">Not currently hit super-effectively: ${coverage.uncovered.map(titleCase).join(', ')}.</p>` : ''}
    ${unknown}`;
}

async function refreshAnalysis() {
  team = await window.teamApi.getTeam();
  renderTeam();
  elements.content.hidden = true;
  elements.empty.hidden = team.length > 0;
  const report = await window.teamApi.analyze();
  team = report.team;
  renderTeam();
  renderAnalysis(report);
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!elements.name.value.trim()) return setMessage('Enter a Pokémon name to add it.', 'error');
  if (team.length === 6) return setMessage('Your party is full — remove a Pokémon to add another.', 'error');
  const button = elements.form.querySelector('button');
  button.disabled = true;
  button.innerHTML = '<span>◌</span> Looking up…';
  setMessage('');
  try {
    team = await window.teamApi.add({ name: elements.name.value });
    elements.name.value = '';
    await refreshAnalysis();
    setMessage('Pokémon added to your party.', 'success');
  } catch (error) {
    setMessage(error.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>+</span> Add to team';
  }
});

elements.showdownForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!elements.showdownText.value.trim()) return setMessage('Paste a Showdown export to import it.', 'error');
  const button = elements.showdownForm.querySelector('button');
  button.disabled = true;
  button.textContent = 'Importing…';
  setMessage('Looking up your imported party…');
  try {
    team = await window.teamApi.importShowdown(elements.showdownText.value);
    elements.showdownText.value = '';
    await refreshAnalysis();
    setMessage('Showdown party imported — items and moves are ready to analyze.', 'success');
  } catch (error) {
    setMessage(error.message || 'Unable to import that Showdown team.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Import party';
  }
});

elements.clear.addEventListener('click', async () => {
  if (!team.length) return;
  team = await window.teamApi.clear();
  await refreshAnalysis();
  setMessage('Your team has been cleared.', 'success');
});

elements.openMatchups.addEventListener('click', () => elements.matchupModal.showModal());
elements.closeMatchups.addEventListener('click', () => elements.matchupModal.close());
elements.matchupModal.addEventListener('click', (event) => {
  if (event.target === elements.matchupModal) elements.matchupModal.close();
});

elements.nature.addEventListener('change', refreshStatPreviews);
elements.statEditor.addEventListener('input', refreshStatPreviews);
elements.closePokemon.addEventListener('click', () => elements.pokemonModal.close());
elements.cancelBuild.addEventListener('click', () => elements.pokemonModal.close());
elements.pokemonModal.addEventListener('click', (event) => {
  if (event.target === elements.pokemonModal) elements.pokemonModal.close();
});
elements.pokemonBuildForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedMember) return;
  const sps = getCurrentSps();
  const total = Object.values(sps).reduce((sum, value) => sum + value, 0);
  if (total > 66) return refreshStatPreviews();
  const button = elements.pokemonBuildForm.querySelector('.primary-button');
  button.disabled = true;
  try {
    team = await window.teamApi.updateBuild({ slot: selectedMember.slot, nature: elements.nature.value, sps });
    await refreshAnalysis();
    elements.pokemonModal.close();
    setMessage(`${titleCase(selectedMember.name)}'s Champions build was updated.`, 'success');
  } catch (error) {
    elements.buildMessage.textContent = error.message || 'Unable to save this build.';
    elements.buildMessage.className = 'build-message error';
  } finally {
    button.disabled = false;
  }
});



const collection = Object.fromEntries([
  'team-tab', 'routes-tab', 'team-workspace', 'routes-workspace', 'open-saved-teams',
  'saved-teams-modal', 'close-saved-teams', 'save-team-form', 'saved-team-name',
  'saved-team-generation', 'saved-team-game', 'save-team-submit', 'cancel-team-edit',
  'saved-team-message', 'saved-team-search', 'saved-team-filter', 'saved-team-list',
  'game-search', 'game-list', 'route-search', 'route-list', 'encounter-title',
  'encounter-context', 'encounter-method', 'encounter-search', 'route-message', 'encounter-results'
].map(id => [id, document.getElementById(id)]));
let games = [];
let savedTeams = [];
let editingTeamId = null;
let selectedGameId = null;
let selectedRouteId = null;
let routes = [];
let encounters = [];
let routeRequest = 0;
let encounterRequest = 0;

function collectionMessage(message = '', error = false) {
  collection['saved-team-message'].textContent = message;
  collection['saved-team-message'].className = `form-message ${error ? 'error' : 'success'}`;
}

function generationOptions() {
  return [...new Set(games.map(game => game.generation).filter(Boolean))].sort((a, b) => a - b)
    .map(gen => `<option value="${gen}">Generation ${gen}</option>`).join('');
}

function fillGameOptions(selected = '') {
  const generation = Number(collection['saved-team-generation'].value);
  collection['saved-team-game'].innerHTML = '<option value="">Any game</option>' + games
    .filter(game => !generation || game.generation === generation)
    .map(game => `<option value="${game.id}">${escapeHtml(game.label)}</option>`).join('');
  collection['saved-team-game'].value = selected;
}

function resetSnapshotEditor() {
  editingTeamId = null;
  collection['save-team-form'].reset();
  fillGameOptions();
  collection['save-team-submit'].textContent = 'Save new team';
  collection['cancel-team-edit'].hidden = true;
}

function renderSavedTeams() {
  const query = collection['saved-team-search'].value.trim().toLowerCase();
  const generation = Number(collection['saved-team-filter'].value);
  const matches = savedTeams.filter(saved => (!generation || saved.generation === generation) &&
    [saved.name, saved.game || '', ...saved.members.map(member => member.name)].join(' ').toLowerCase().includes(query));
  collection['saved-team-list'].innerHTML = matches.length ? matches.map(saved => `
    <article class="saved-team-card" data-team-id="${saved.id}">
      <div class="saved-team-heading"><div><h3>${escapeHtml(saved.name)}</h3><p>${escapeHtml(saved.game || 'Any game')} · ${saved.generation ? `Generation ${saved.generation}` : 'Any generation'} · ${saved.members.length} / 6</p></div><button class="secondary-button" type="button" data-action="load">Load team</button></div>
      <div class="saved-members">${saved.members.map(member => `<span>${member.slot}. ${escapeHtml(titleCase(member.name))}</span>`).join('')}</div>
      <div class="saved-team-footer"><small>Saved ${escapeHtml(new Date(saved.updated_at.replace(' ', 'T') + 'Z').toLocaleString())}</small><div><button class="text-button" type="button" data-action="edit">Overwrite with current party…</button><button class="text-button" type="button" data-action="delete">Delete</button></div></div>
    </article>`).join('') : `<p class="list-empty">${savedTeams.length ? 'No saved teams match these filters.' : 'No teams saved yet. Save your current party above.'}</p>`;
}

collection['open-saved-teams'].addEventListener('click', async () => {
  collection['saved-teams-modal'].showModal();
  collection['saved-team-list'].innerHTML = '<p class="list-empty">Loading saved teams…</p>';
  collectionMessage();
  try {
    await catalogReady;
    savedTeams = await window.teamApi.listSavedTeams();
    renderSavedTeams();
  } catch (error) {
    collectionMessage(error.message, true);
    collection['saved-team-list'].innerHTML = '<p class="list-empty">Unable to load saved teams. Close and reopen to retry.</p>';
  }
});
collection['close-saved-teams'].addEventListener('click', () => collection['saved-teams-modal'].close());
collection['saved-teams-modal'].addEventListener('click', event => {
  if (event.target === collection['saved-teams-modal']) collection['saved-teams-modal'].close();
});
collection['saved-team-generation'].addEventListener('change', () => fillGameOptions());
collection['saved-team-game'].addEventListener('change', () => {
  const game = games.find(game => game.id === Number(collection['saved-team-game'].value));
  if (game) collection['saved-team-generation'].value = game.generation || '';
});
collection['cancel-team-edit'].addEventListener('click', () => { resetSnapshotEditor(); collectionMessage(); });
collection['saved-team-search'].addEventListener('input', renderSavedTeams);
collection['saved-team-filter'].addEventListener('change', renderSavedTeams);
collection['save-team-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const button = collection['save-team-submit'];
  button.disabled = true;
  try {
    await catalogReady;
    await window.teamApi.saveTeam({
      id: editingTeamId, name: collection['saved-team-name'].value,
      gameId: collection['saved-team-game'].value || null,
      generation: collection['saved-team-generation'].value || null
    });
    const updated = Boolean(editingTeamId);
    resetSnapshotEditor();
    savedTeams = await window.teamApi.listSavedTeams();
    renderSavedTeams();
    collectionMessage(updated ? 'Saved team replaced with the current party.' : 'Team saved. You can now load it from your collection.');
  } catch (error) { collectionMessage(error.message || 'Unable to save this team.', true); }
  finally { button.disabled = false; }
});
collection['saved-team-list'].addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = Number(button.closest('[data-team-id]').dataset.teamId);
  const saved = savedTeams.find(entry => entry.id === id);
  if (!saved) return;
  const action = button.dataset.action;
  if (action === 'edit') {
    editingTeamId = id;
    collection['saved-team-name'].value = saved.name;
    collection['saved-team-generation'].value = saved.generation || '';
    fillGameOptions(saved.game_id || '');
    collection['save-team-submit'].textContent = 'Overwrite saved team';
    collection['cancel-team-edit'].hidden = false;
    collectionMessage(`Editing “${saved.name}”. Saving replaces its snapshot with the current party and these assignments.`);
    collection['saved-team-name'].focus();
    return;
  }
  if (action === 'delete' && !button.dataset.confirm) {
    button.dataset.confirm = 'true';
    button.textContent = 'Confirm delete';
    collectionMessage(`Click Confirm delete to remove “${saved.name}”. The current party is kept.`);
    return;
  }
  button.disabled = true;
  try {
    if (action === 'load') {
      team = await window.teamApi.loadTeam(id);
      renderTeam();
      resetSnapshotEditor();
      collection['saved-teams-modal'].close();
      await refreshAnalysis();
      setMessage(`Loaded “${saved.name}”${saved.game ? ` · ${saved.game}` : ''}. Changes autosave to the current party; use Saved teams to update its snapshot.`, 'success');
    } else if (action === 'delete') {
      await window.teamApi.deleteTeam(id);
      if (editingTeamId === id) resetSnapshotEditor();
      savedTeams = await window.teamApi.listSavedTeams();
      renderSavedTeams();
      collectionMessage('Saved team deleted.');
    }
  } catch (error) {
    if (collection['saved-teams-modal'].open) collectionMessage(error.message, true);
    else setMessage(`Party loaded; analysis could not refresh: ${error.message}`, 'error');
  } finally { button.disabled = false; }
});

function selectTab(name) {
  for (const tab of ['team', 'routes']) {
    const selected = name === tab;
    collection[`${tab}-tab`].setAttribute('aria-selected', String(selected));
    collection[`${tab}-tab`].tabIndex = selected ? 0 : -1;
    collection[`${tab}-workspace`].hidden = !selected;
  }
}
for (const name of ['team', 'routes']) {
  collection[`${name}-tab`].addEventListener('click', () => selectTab(name));
  collection[`${name}-tab`].addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 'team' : event.key === 'End' ? 'routes' : name === 'team' ? 'routes' : 'team';
      selectTab(next);
      collection[`${next}-tab`].focus();
    }
  });
}

function renderGames() {
  const query = collection['game-search'].value.trim().toLowerCase();
  const matches = games.filter(game => `${game.label} generation ${game.generation}`.toLowerCase().includes(query));
  let generation = undefined;
  collection['game-list'].innerHTML = matches.map(game => {
    const heading = generation !== game.generation ? `<h3 class="list-group-heading">${game.generation ? `Generation ${game.generation}` : 'Other games'}</h3>` : '';
    generation = game.generation;
    return `${heading}<button type="button" class="explorer-item" data-game-id="${game.id}" aria-pressed="${game.id === selectedGameId}"><span>${escapeHtml(game.label)}</span><small>${game.has_encounters ? 'View locations →' : 'No encounter data'}</small></button>`;
  }).join('') || '<p class="list-empty">No matching games.</p>';
}

function renderRoutes() {
  const query = collection['route-search'].value.trim().toLowerCase();
  const matches = routes.filter(route => route.name.toLowerCase().includes(query));
  collection['route-list'].innerHTML = matches.map(route => `<button type="button" class="explorer-item" data-route-id="${route.id}" aria-pressed="${route.id === selectedRouteId}"><span>${escapeHtml(route.name)}</span><small>${route.area_count} area${route.area_count === 1 ? '' : 's'}</small></button>`).join('') || '<p class="list-empty">No matching routes or locations.</p>';
}

function resetEncounterResults(title, message) {
  encounters = [];
  collection['encounter-title'].textContent = title;
  collection['encounter-context'].textContent = '';
  collection['encounter-method'].innerHTML = '<option value="">All methods</option>';
  collection['encounter-method'].disabled = true;
  collection['encounter-search'].value = '';
  collection['encounter-search'].disabled = true;
  collection['route-message'].textContent = '';
  collection['encounter-results'].innerHTML = `<p class="list-empty">${escapeHtml(message)}</p>`;
}

function renderEncounters() {
  const method = collection['encounter-method'].value;
  const query = collection['encounter-search'].value.trim().toLowerCase();
  const matches = encounters.filter(entry => (!method || entry.method === method) &&
    `${entry.pokemon} ${entry.conditions} ${entry.area}`.toLowerCase().includes(query));
  collection['encounter-context'].textContent = `${games.find(game => game.id === selectedGameId)?.label || ''} · ${matches.length} of ${encounters.length} encounter slots`;
  collection['encounter-results'].innerHTML = matches.length ? `<div class="encounter-table-scroll"><table class="encounter-table"><thead><tr><th>Pokémon / area</th><th>Method / conditions</th><th>Level</th><th>Slot rate</th></tr></thead><tbody>${matches.map(entry => `<tr><td><strong>${escapeHtml(titleCase(entry.pokemon))}</strong><small>${escapeHtml(entry.area)}</small></td><td>${escapeHtml(entry.method)}<small>${escapeHtml(entry.conditions || 'No additional conditions listed')}</small></td><td>${entry.min_level === entry.max_level ? entry.min_level : `${entry.min_level}–${entry.max_level}`}</td><td><span class="rate-badge">${entry.chance === null ? '—' : `${entry.chance}%`}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="list-empty">No encounter slots match these filters.</p>';
}

collection['game-search'].addEventListener('input', renderGames);
collection['route-search'].addEventListener('input', renderRoutes);
collection['encounter-method'].addEventListener('change', renderEncounters);
collection['encounter-search'].addEventListener('input', renderEncounters);
collection['game-list'].addEventListener('click', async event => {
  const button = event.target.closest('[data-game-id]');
  if (!button) return;
  const gameId = Number(button.dataset.gameId);
  const game = games.find(game => game.id === gameId);
  const request = ++routeRequest;
  ++encounterRequest;
  selectedGameId = gameId;
  selectedRouteId = null;
  routes = [];
  renderGames();
  collection['route-search'].value = '';
  collection['route-search'].disabled = true;
  collection['route-list'].innerHTML = '<p class="list-empty">Loading routes…</p>';
  resetEncounterResults(game.label, 'Choose a route or location.');
  try {
    const result = await window.teamApi.getRoutes(gameId);
    if (request !== routeRequest) return;
    routes = result;
    collection['route-search'].disabled = !routes.length;
    if (routes.length) renderRoutes();
    else {
      collection['route-list'].innerHTML = '<p class="list-empty">No encounter locations in this catalog.</p>';
      resetEncounterResults(game.label, 'PokéAPI has no encounter records for this game in the bundled catalog. You can still assign saved teams to this game.');
    }
  } catch (error) {
    if (request !== routeRequest) return;
    collection['route-list'].innerHTML = '<p class="list-empty">Unable to load routes. Select the game again to retry.</p>';
    collection['route-message'].textContent = error.message;
  }
});
collection['route-list'].addEventListener('click', async event => {
  const button = event.target.closest('[data-route-id]');
  if (!button) return;
  const routeId = Number(button.dataset.routeId);
  const gameId = selectedGameId;
  const route = routes.find(route => route.id === routeId);
  const request = ++encounterRequest;
  selectedRouteId = routeId;
  renderRoutes();
  resetEncounterResults(route.name, 'Loading encounter slots…');
  try {
    const result = await window.teamApi.getEncounters({ gameId, routeId });
    if (request !== encounterRequest) return;
    encounters = result;
    const methods = [...new Set(encounters.map(entry => entry.method))].sort();
    collection['encounter-method'].innerHTML = '<option value="">All methods</option>' + methods.map(method => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join('');
    collection['encounter-method'].disabled = !encounters.length;
    collection['encounter-search'].disabled = !encounters.length;
    renderEncounters();
  } catch (error) {
    if (request !== encounterRequest) return;
    resetEncounterResults(route.name, 'Unable to load encounters. Select the route again to retry.');
    collection['route-message'].textContent = error.message;
  }
});

const catalogReady = window.teamApi.getGames().then(result => {
  games = result;
  collection['saved-team-generation'].innerHTML += generationOptions();
  collection['saved-team-filter'].innerHTML += generationOptions();
  fillGameOptions();
  renderGames();
});
catalogReady.catch(error => {
  collection['route-message'].textContent = error.message || 'Unable to load the game catalog.';
  collection['game-list'].innerHTML = '<p class="list-empty">Game catalog unavailable. Restart the app to retry.</p>';
});
refreshAnalysis().catch(error => setMessage(error.message || 'Unable to load your current party.', 'error'));

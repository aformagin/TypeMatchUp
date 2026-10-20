const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('teamApi', {
  getGames: () => ipcRenderer.invoke('games:list'),
  getRoutes: (gameId) => ipcRenderer.invoke('routes:list', gameId),
  getEncounters: (payload) => ipcRenderer.invoke('routes:encounters', payload),
  listSavedTeams: () => ipcRenderer.invoke('saved-teams:list'),
  saveTeam: (payload) => ipcRenderer.invoke('saved-teams:save', payload),
  loadTeam: (id) => ipcRenderer.invoke('saved-teams:load', id),
  deleteTeam: (id) => ipcRenderer.invoke('saved-teams:delete', id),
  getTeam: () => ipcRenderer.invoke('team:get'),
  getDetails: (slot) => ipcRenderer.invoke('team:details', slot),
  analyze: () => ipcRenderer.invoke('team:analysis'),
  add: (payload) => ipcRenderer.invoke('team:add', payload),
  importShowdown: (text) => ipcRenderer.invoke('team:import', text),
  updateBuild: (payload) => ipcRenderer.invoke('team:update-build', payload),
  remove: (slot) => ipcRenderer.invoke('team:remove', slot),
  clear: () => ipcRenderer.invoke('team:clear')
});

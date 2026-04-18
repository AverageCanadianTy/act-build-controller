import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Utility
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (filters) => ipcRenderer.invoke('select-file', filters),

  // Directory
  scanDirectory: (path) => ipcRenderer.invoke('scan-directory', path),

  // Project
  saveProject: (args) => ipcRenderer.invoke('save-project', args),
  loadProject: (filePath) => ipcRenderer.invoke('load-project', filePath),
  openProjectFile: () => ipcRenderer.invoke('open-project-file'),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  addRecentProject: (args) => ipcRenderer.invoke('add-recent-project', args),

  // Subfolder & versioning
  ensureSubfolder: (args) => ipcRenderer.invoke('ensure-subfolder', args),
  scanOutputVersion: (args) => ipcRenderer.invoke('scan-output-version', args),

  // Repomixignore
  writeRepomixIgnore: (args) => ipcRenderer.invoke('write-repomixignore', args),
  parseRepomixIgnore: (filePath) => ipcRenderer.invoke('parse-repomixignore', filePath),

  // Build
  runScript: (command) => ipcRenderer.send('execute-command', command),

  // Directory Builder
  createProjectDirectory: (args) => ipcRenderer.invoke('create-project-directory', args),
  scanBloat: (args) => ipcRenderer.invoke('scan-bloat', args),

  // OAuth
  getOAuthStatus: () => ipcRenderer.invoke('get-oauth-status'),
  parseClientSecretFile: (filePath) => ipcRenderer.invoke('parse-client-secret-file', filePath),
  startOAuthFlow: (args) => ipcRenderer.invoke('start-oauth-flow', args),
  disconnectGoogle: (args) => ipcRenderer.invoke('disconnect-google', args),

  // Users
  getUsers: () => ipcRenderer.invoke('get-users'),
  registerUser: (args) => ipcRenderer.invoke('register-user', args),
  loginUser: (args) => ipcRenderer.invoke('login-user', args),
  updateAutoLogin: (args) => ipcRenderer.invoke('update-auto-login', args),
  generateCollabToken: (args) => ipcRenderer.invoke('generate-collab-token', args),
  revokeCollaborator: (args) => ipcRenderer.invoke('revoke-collaborator', args),
  redeemCollabToken: (args) => ipcRenderer.invoke('redeem-collab-token', args),

  // Sheet Tracker
  validateSheetId: (sheetId) => ipcRenderer.invoke('validate-sheet-id', sheetId),  fetchSheetData: (args) => ipcRenderer.invoke('fetch-sheet-data', args),
  generateSheetScript: (args) => ipcRenderer.invoke('generate-sheet-script', args),
  importSheetScript: (filePath) => ipcRenderer.invoke('import-sheet-script', filePath),

// Code Patcher
readFileForPatch: (filePath) => ipcRenderer.invoke('read-file-for-patch', filePath),
applyPatches: (args) => ipcRenderer.invoke('apply-patches', args),

  // Terminal log listener
  onLog: (callback) => {
    const listener = (_, data) => callback(data)
    ipcRenderer.on('terminal-data', listener)
    return () => ipcRenderer.removeListener('terminal-data', listener)
  }
}

if (process.contextIsolated) {
  try { contextBridge.exposeInMainWorld('api', api) } catch (e) { console.error(e) }
} else {
  window.api = api
}
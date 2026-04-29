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

    // Matrix utilities
  getFileMtime: (filePath) => ipcRenderer.invoke('get-file-mtime', filePath),
  readMatrixHeader: (xmlPath) => ipcRenderer.invoke('read-matrix-header', xmlPath),

  // Restore
  stageRestore: (args) => ipcRenderer.invoke('stage-restore', args),
  validateRestore: (args) => ipcRenderer.invoke('validate-restore', args),
  applyRestore: (args) => ipcRenderer.invoke('apply-restore', args),
  abortRestore: (args) => ipcRenderer.invoke('abort-restore', args),

  // Build
  runScript: (args) => ipcRenderer.send('execute-command', args),

  // Directory Builder
    createProjectDirectory: (args) => ipcRenderer.invoke('create-project-directory', args),
        scanBloat: (args) => ipcRenderer.invoke('scan-bloat', args),
  checkRuntimeDeps: () => ipcRenderer.invoke('check-runtime-deps'),
  verifyDevkitInstalled: (args) => ipcRenderer.invoke('verify-devkit-installed', args),
  generateSqliteSchema: (args) => ipcRenderer.invoke('generate-sqlite-schema', args),
  generatePostgresSchema: (args) => ipcRenderer.invoke('generate-postgres-schema', args),
  writeMigrationDoc: (args) => ipcRenderer.invoke('write-migration-doc', args),

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

  // GitHub & Release
  saveGithubPat: (args) => ipcRenderer.invoke('save-github-pat', args),
  getGithubPat: (userId) => ipcRenderer.invoke('get-github-pat', userId),
  testGithubConnection: (args) => ipcRenderer.invoke('test-github-connection', args),
  generateGithubWorkflow: (args) => ipcRenderer.invoke('generate-github-workflow', args),
  dispatchGithubWorkflow: (args) => ipcRenderer.invoke('dispatch-github-workflow', args),
  pollGithubRun: (args) => ipcRenderer.invoke('poll-github-run', args),
    getPackageVersion: (projectPath) => ipcRenderer.invoke('get-package-version', projectPath),
  bumpPackageVersion: (args) => ipcRenderer.invoke('bump-package-version', args),
  patchElectronBuilderMac: (args) => ipcRenderer.invoke('patch-electron-builder-mac', args),

      getGitRemote: (projectPath) => ipcRenderer.invoke('get-git-remote', projectPath),
  updatePackageHomepage: (args) => ipcRenderer.invoke('update-package-homepage', args),

  logError: (args) => ipcRenderer.invoke('log-error', args),
  commitPushWorkflow: (projectPath) => ipcRenderer.invoke('commit-push-workflow', projectPath),

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
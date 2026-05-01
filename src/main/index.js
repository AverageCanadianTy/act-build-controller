import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { exec } from 'child_process'
import https from 'https'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import yaml from 'js-yaml'
import icon from '../../resources/icon.png?asset'
app.commandLine.appendSwitch('no-sandbox')
let mainWindow


// ── Helpers ──────────────────────────────────────────────────────────────────
const oauthConfigPath = () => join(app.getPath('userData'), 'act-oauth.json')
const usersPath = () => join(app.getPath('userData'), 'act-users.json')
const readUsers = () => { try { return JSON.parse(fs.readFileSync(usersPath(), 'utf-8')) } catch { return { users: [] } } }
const writeUsers = (data) => fs.writeFileSync(usersPath(), JSON.stringify(data, null, 2))
async function getValidAccessToken() {
  const configPath = oauthConfigPath()
  if (!fs.existsSync(configPath)) throw new Error('No OAuth token configured')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  if (Date.now() < config.expiresAt - 60000) return config.accessToken
  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token'
    }).toString()
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error_description || data.error)
  config.accessToken = data.access_token
  config.expiresAt = Date.now() + (data.expires_in * 1000)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  return config.accessToken
}

function toSheetSubfolder(label) {
  return `${label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-sheet-matrices`
}

// ── Schema Migration ─────────────────────────────────────────────────────────
function migrateProjectSchema(data, filePath) {
  let changed = false
  if (!data.devKit) {
    data.devKit = { selections: [], installed: [], pending: [], activeDependencies: [] }
    changed = true
  }
  if (data.matrixVersion === undefined) {
    data.matrixVersion = 0
    data.matrixHistory = []
    changed = true
  }
  if (!data.dbTargets) {
    data.dbTargets = []
    changed = true
  }
    if (data.databaseType === undefined) {
    data.databaseType = null
    changed = true
  }
    if (data.runCommand === undefined) {
    data.runCommand = null
    changed = true
  }
  data.dbTargets.forEach(t => { if (t.type === 'SHEETS') { t.type = 'sheets'; changed = true } })
  if (data.sheetTracker?.groups?.length > 0 && data.dbTargets.length === 0) {
    data.dbTargets = data.sheetTracker.groups.map(g => ({
      id: `db_sheets_${g.id || Date.now()}`,
      type: 'sheets',
      label: g.label || g.name || 'Sheets Group',
      connectionInfo: '',
      lastExported: null,
      config: { sheetIds: g.sheetIds || [] }
    }))
    changed = true
  }
    if (data.sheetTracker && (data.sheetTracker.enabled !== undefined || data.sheetTracker.groups?.length)) {
    data.sheetTracker = {}
    changed = true
  }
  if (data.targets) {
    data.targets.forEach(t => { if (t.fileTree !== undefined) { delete t.fileTree; changed = true } })
  }
  if (changed && filePath) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)) } catch {}
  }
  return data
}

// ── Code Patcher — hunk apply engine ─────────────────────────────────────────
function applyHunks(fileContent, hunks) {
  let text = fileContent.replace(/\r\n/g, '\n')

  // New file — all lines are additions, no context to match
  const isNewFile = fileContent === '' && hunks.every(h =>
    h.lines.filter(l => l !== '').every(l => l.startsWith('+'))
  )
  if (isNewFile) {
    const content = hunks.flatMap(h => h.lines.filter(l => l.startsWith('+')).map(l => l.slice(1))).join('\n')
    return { success: true, content }
  }

  const getHunkData = (lines) => {
    const before = [], after = []
    for (const l of lines) {
      if (l.startsWith('-')) { before.push(l.slice(1)) }
      else if (l.startsWith('+')) { after.push(l.slice(1)) }
      else { const c = l.startsWith(' ') ? l.slice(1) : l; before.push(c); after.push(c) }
    }
    return { before: before.join('\n'), after: after.join('\n') }
  }

  const fuzzyPattern = (str) => {
    const chunks = str.split(/\s+/).filter(Boolean)
    if (!chunks.length) return null
    return new RegExp(chunks.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'sg')
  }

  for (let i = 0; i < hunks.length; i++) {
    const hunkNum = `Hunk ${i + 1} of ${hunks.length}`
    // Filter empty trailing lines but preserve blank context lines mid-hunk
    const lines = hunks[i].lines
    const { before, after } = getHunkData(lines)

    // Tier 1: full context fuzzy match — find ALL candidates
    let pat = fuzzyPattern(before)
    let matches = pat ? [...text.matchAll(pat)] : []

    if (matches.length > 1) {
      return {
        success: false,
        error: `${hunkNum}: ${matches.length} candidate locations found — context is ambiguous. Expand context window.\n\nExpected context:\n${before.split('\n').map(l => `  ${l}`).join('\n')}`
      }
    }

    if (matches.length === 1) {
      const m = matches[0]
      text = text.slice(0, m.index) + after + text.slice(m.index + m[0].length)
      continue
    }

    // Tier 2: deletion-only anchor
    const deletions = lines.filter(l => l.startsWith('-')).map(l => l.slice(1)).join('\n')
    pat = fuzzyPattern(deletions)
    matches = pat ? [...text.matchAll(pat)] : []

    if (matches.length > 1) {
      return {
        success: false,
        error: `${hunkNum}: ${matches.length} candidate locations found via deletion anchor — context is ambiguous. Expand context window.\n\nExpected context:\n${before.split('\n').map(l => `  ${l}`).join('\n')}`
      }
    }

    if (matches.length === 1) {
      const m = matches[0]
      text = text.slice(0, m.index) + after + text.slice(m.index + m[0].length)
      continue
    }

    // Both tiers failed — context not found
    return {
      success: false,
      error: `${hunkNum}: context not found in file.\n\nExpected context:\n${before.split('\n').slice(0, 4).map(l => `  ${l}`).join('\n')}`
    }
  }

  
  return { success: true, content: text }
}

// ── File tree builder (module-level for lazy rescan) ──────────────────────────
function buildFileTree(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({
        name: e.name,
        path: join(dir, e.name),
        isDirectory: e.isDirectory(),
        children: e.isDirectory() ? buildFileTree(join(dir, e.name)) : []
      }))
  } catch { return [] }
}
// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 780,
    backgroundColor: '#0f1115',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
    mainWindow.on('ready-to-show', () => {
  mainWindow.show()
  mainWindow.webContents.on('console-message', (event) => {
    console.log(`[RENDERER] ${event.message} (${event.sourceId}:${event.lineNumber})`)
  })
  mainWindow.webContents.openDevTools()
})
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    app.commandLine.appendSwitch('disable-dev-shm-usage')

function annotateMatrix(filePath, projectFilePath) {
  let content = fs.readFileSync(filePath, 'utf-8')

  // Bump version in project file
  let newVersion = 1
  if (projectFilePath) {
    try {
      const proj = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
      newVersion = (proj.matrixVersion ?? 0) + 1
      proj.matrixVersion = newVersion
      proj.matrixHistory = proj.matrixHistory || []
      proj.matrixHistory.push({
        version: newVersion,
        timestamp: new Date().toISOString(),
        file: filePath.split(/[/\\]/).pop()
      })
      fs.writeFileSync(projectFilePath, JSON.stringify(proj, null, 2), 'utf-8')
    } catch (e) { /* non-fatal */ }
  }

  // Inject or update header
  const target = filePath.split(/[/\\]/).pop().replace(/\.xml$/, '')
  const generated = new Date().toISOString()
  if (!content.startsWith('<!-- ACT Matrix')) {
    content = `<!-- ACT Matrix | version=${newVersion} | generated=${generated} | target=${target} -->\n` + content
  } else {
    content = content.replace(
      /^<!-- ACT Matrix \| version=[^|]+ \| generated=[^|]+ \| target=[^ ]+ -->/,
      `<!-- ACT Matrix | version=${newVersion} | generated=${generated} | target=${target} -->`
    )
  }

  // Annotate line numbers
  const annotated = content.replace(
    /(<file path="[^"]+">)([\s\S]*?)(<\/file>)/g,
    (_, open, body, close) => {
      const lines = body.split('\n')
      if (lines[1] && /^\s*\d+\|/.test(lines[1])) return _
      const numbered = lines.map((line, i) => {
        if (i === 0 || i === lines.length - 1) return line
        return `${String(i).padStart(5)}| ${line}`
      })
      return `${open}${numbered.join('\n')}${close}`
    }
  )
    fs.writeFileSync(filePath, annotated, 'utf-8')
}

// ── Axiomix YAML Serializer ───────────────────────────────────────────────────
function serializeToYAML(xmlPath, projectFilePath) {
  const content = fs.readFileSync(xmlPath, 'utf-8')

  // Extract ACT header metadata
  const headerMatch = content.match(
    /<!-- ACT Matrix \| version=(\d+) \| generated=([^|]+) \| target=([^ ]+) -->/
  )
  const version = headerMatch ? parseInt(headerMatch[1]) : 0
    const generated = headerMatch ? headerMatch[2].trim() : new Date().toISOString()
  const target = headerMatch ? headerMatch[3] : xmlPath.split(/[/\\]/).pop().replace(/\.xml$/, '')

  // Extract stable class name directly from the target filename
  // e.g. actbuildcontroller_backend_file_matrix_v27 → 'backend'
  // e.g. actbuildcontroller_file_matrix_v77         → 'root'
  const classMatch = target.match(/_([a-z]+)_file_matrix_v\d+$/)
  const stableClass = classMatch ? classMatch[1] : 'root'

  // Resolve project name from .actproject
  let projectName = target
  if (projectFilePath) {
    try {
      const proj = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
      if (proj.name) projectName = proj.name
    } catch { /* non-fatal */ }
  }

  // Parse annotated file blocks from XML
  const files = []
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
  let match
  while ((match = fileRegex.exec(content)) !== null) {
    files.push({ path: match[1], content: match[2].trim() })
  }

  // Serialize to YAML — js-yaml auto-uses literal block scalars for multiline strings
  const doc = {
    matrix: {
      project: projectName,
            version,
      generated,
      target,
      domain: stableClass,
      file_count: files.length,
      files
    }
  }


  // Write to a stable axiomix folder — always overwrites, no versioning
  let yamlDir = xmlPath.split(/[/\\]/).slice(0, -1).join('/')
  if (projectFilePath) {
    try {
      const proj = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
      if (proj.knowledgePath) {
        yamlDir = proj.knowledgePath + '/axiomix'
        if (!fs.existsSync(yamlDir)) fs.mkdirSync(yamlDir, { recursive: true })
      }
    } catch { /* fall back to xml sibling dir */ }
  }
    const header = `# ACT Matrix | version=${version} | generated=${generated} | target=${target} | format=axiomix-yaml\n`
  const yamlContent = header + yaml.dump(doc, { lineWidth: -1, noRefs: true })

  const yamlPath = yamlDir + '/' + stableClass + '.yaml'
      fs.writeFileSync(yamlPath, yamlContent, 'utf-8')
  return yamlPath
}

// ── Context Lattice Generator ─────────────────────────────────────────────
function generateRelationalAudit(xmlPath, projectFilePath) {
  if (!projectFilePath) return
  try {
    const content = fs.readFileSync(xmlPath, 'utf-8')
    const proj = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
    const knowledgePath = proj.knowledgePath
    const projectName = proj.name || 'unknown'
    if (!knowledgePath) return
    const importMap = {}
    const invokeMap = {}
    const handlerMap = {}
    const externalVectors = new Set()
    const fileBlockRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
    let match
        while ((match = fileBlockRegex.exec(content)) !== null) {
      const filePath = match[1]
      const fileContent = match[2]
      if (!filePath.endsWith('.js') && !filePath.endsWith('.jsx')) continue
      const importRegex = /(?:import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g
      let imp
      while ((imp = importRegex.exec(fileContent)) !== null) {
        const target = imp[1] || imp[2]
        if (target.startsWith('.')) {
          if (!importMap[filePath]) importMap[filePath] = []
          if (!importMap[filePath].includes(target)) importMap[filePath].push(target)
        } else {
          externalVectors.add(target.split('/')[0])
        }
      }
      const invokeRegex = /window\.api\.(\w+)\s*\(|ipcRenderer\.invoke\(['"]([^'"]+)['"]/g
      let inv
      while ((inv = invokeRegex.exec(fileContent)) !== null) {
        const channel = inv[1] || inv[2]
        if (!invokeMap[filePath]) invokeMap[filePath] = []
        if (!invokeMap[filePath].includes(channel)) invokeMap[filePath].push(channel)
      }
      const handlerRegex = /ipcMain\.(?:handle|on)\(['"]([^'"]+)['"]/g
      let han
      while ((han = handlerRegex.exec(fileContent)) !== null) {
        if (!handlerMap[filePath]) handlerMap[filePath] = []
        if (!handlerMap[filePath].includes(han[1])) handlerMap[filePath].push(han[1])
      }
    }
    const audit = {
      topology: 'ACT_Context_Lattice',
      generated_at: new Date().toISOString(),
      project: projectName,
      imports: Object.entries(importMap).map(([from, to]) => ({ from, to })),
      ipc_invoke: Object.entries(invokeMap).map(([from, channels]) => ({ from, to: 'src/main/index.js', channels })),
      ipc_handlers: Object.entries(handlerMap).map(([file, channels]) => ({ file, channels })),
      external_vectors: [...externalVectors]
    }
    const axiomixDir = knowledgePath + '/axiomix'
    if (!fs.existsSync(axiomixDir)) fs.mkdirSync(axiomixDir, { recursive: true })
    fs.writeFileSync(axiomixDir + '/relational_audit.json', JSON.stringify(audit, null, 2), 'utf-8')
  } catch (e) { /* non-fatal */ }
}

function scanDependencies(matrixPath, projectFilePath) {
  if (!projectFilePath) return
  try {
    const content = fs.readFileSync(matrixPath, 'utf-8')
    const found = new Set()
    const jsRe = /(?:import\s+[\s\S]*?\s+from\s+['"]([^'"./][^'"]*?)['"]|require\(['"]([^'"./][^'"]*?)['"]\))/g
    let m
    while ((m = jsRe.exec(content)) !== null) {
      const raw = (m[1] || m[2]).split('/')[0]
      if (raw) found.add(raw)
    }
    const pyRe = /(?:^import\s+(\S+)|^from\s+(\S+)\s+import)/gm
    while ((m = pyRe.exec(content)) !== null) {
      const raw = (m[1] || m[2]).split('.')[0]
      if (raw) found.add(raw)
    }
    const proj = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
    proj.devKit = proj.devKit || { selections: [], installed: [], pending: [], activeDependencies: [] }
    proj.devKit.activeDependencies = [...found]
    fs.writeFileSync(projectFilePath, JSON.stringify(proj, null, 2), 'utf-8')
  } catch (e) { /* non-fatal */ }
}

  // ── Utility ──────────────────────────────────────────────────────────────
  ipcMain.handle('open-external', async (_, url) => shell.openExternal(url))

  // ── User auth ─────────────────────────────────────────────────────────────
  ipcMain.handle('get-users', async () => {
    const { users } = readUsers()
    return users.map(u => ({ id: u.id, displayName: u.displayName, autoLogin: u.autoLogin || false }))
  })

  ipcMain.handle('register-user', async (_, { displayName, password }) => {
    try {
      const store = readUsers()
      if (store.users.find(u => u.displayName.toLowerCase() === displayName.toLowerCase()))
        return { success: false, error: 'Display name already taken' }
      const passwordHash = await bcrypt.hash(password, 12)
      const user = { id: `u_${crypto.randomBytes(8).toString('hex')}`, displayName, passwordHash, autoLogin: false, googleTokens: null, createdAt: new Date().toISOString() }
      store.users.push(user)
      writeUsers(store)
      return { success: true, user: { id: user.id, displayName: user.displayName, autoLogin: user.autoLogin } }
    } catch (error) { return { success: false, error: error.message } }
  })

  // ── Code Patcher ──────────────────────────────────────────────────────────
ipcMain.handle('read-file-for-patch', async (_, { filePath }) => {
  try {
    return { success: true, content: fs.readFileSync(filePath, 'utf-8') }
  } catch (error) { return { success: false, error: error.message } }
})

ipcMain.handle('apply-patches', async (_, { patches, rootPath }) => {
  const log = (msg) => mainWindow.webContents.send('terminal-data', msg)
  log(`[PATCHER] Deploying ${patches.length} patch(es)...\n`)
  // Phase 1: snapshot all target files into memory
  const snapshots = {}
  for (const patch of patches) {
    if (!(patch.targetPath in snapshots)) {
      try {
        snapshots[patch.targetPath] = fs.readFileSync(join(rootPath, patch.targetPath), 'utf-8')
      } catch {
        // File does not exist yet — treat as empty (supports new file creation)
        snapshots[patch.targetPath] = ''
      }
    }
  }
  // Phase 2: apply hunks against snapshots
  const results = []
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i]
    const label = `[PATCH ${i + 1}/${patches.length}]`
    const result = applyHunks(snapshots[patch.targetPath], patch.hunks)
    if (result.success) {
      snapshots[patch.targetPath] = result.content
      results.push({ path: patch.targetPath, success: true })
      log(`${label} ${patch.targetPath} ✓\n`)
    } else {
      results.push({ path: patch.targetPath, success: false, error: result.error })
      log(`${label} ${patch.targetPath}\n  ✗ ${result.error}\n`)
      log(`[PATCHER] Deployment halted. ${i} patch(es) applied, ${patches.length - i - 1} skipped.\n`)
      return { results }
    }
  }

  // Phase 3: write to disk only if ALL patches succeeded
  for (const [relativePath, content] of Object.entries(snapshots)) {
    try {
      const fullPath = join(rootPath, relativePath)
      fs.mkdirSync(join(fullPath, '..'), { recursive: true })
      fs.writeFileSync(fullPath, content, 'utf-8')
    } catch (writeErr) {
      log(`[PATCHER] Write failed for ${relativePath}: ${writeErr.message}\n`)
      return { results: results.map(r =>
        r.path === relativePath
          ? { ...r, success: false, error: `Write failed: ${writeErr.message}` }
          : r
      )}
    }
  }
    log(`[PATCHER] All patches applied successfully.\n`)
    return { results }
    })

  ipcMain.handle('login-user', async (_, { displayName, password }) => {
    try {
      const { users } = readUsers()
      const user = users.find(u => u.displayName.toLowerCase() === displayName.toLowerCase())
      if (!user) return { success: false, error: 'User not found' }
      const match = await bcrypt.compare(password, user.passwordHash)
      if (!match) return { success: false, error: 'Incorrect password' }
      return { success: true, user: { id: user.id, displayName: user.displayName, autoLogin: user.autoLogin } }
    } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('update-auto-login', async (_, { userId, autoLogin }) => {
    try {
      const store = readUsers()
      store.users = store.users.map(u => u.id === userId ? { ...u, autoLogin } : { ...u, autoLogin: false })
      writeUsers(store)
      return { success: true }
    } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('disconnect-google', async (_, { userId }) => {
    try {
      const store = readUsers()
      store.users = store.users.map(u => u.id === userId ? { ...u, googleTokens: null } : u)
      writeUsers(store)
      return { success: true }
    } catch (error) { return { success: false, error: error.message } }
  })

  // ── Selection dialogs ─────────────────────────────────────────────────────
  ipcMain.handle('select-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('select-file', async (_, filters) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
    return canceled ? null : filePaths[0]
    })

  // ── Directory scanning ────────────────────────────────────────────────────
  ipcMain.handle('scan-directory', async (_, rootPath) => {
    try { return buildFileTree(rootPath) } catch { return [] }
  })

  // ── Project file operations ───────────────────────────────────────────────
  ipcMain.handle('save-project', async (_, { knowledgePath, projectName, data }) => {
        try {
      if (!fs.existsSync(knowledgePath)) fs.mkdirSync(knowledgePath, { recursive: true })
      const safe = projectName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const filePath = join(knowledgePath, `${safe}_matrices.actproject`)
      const lean = { ...data, targets: (data.targets || []).map(({ fileTree: _ft, ...t }) => t) }
      fs.writeFileSync(filePath, JSON.stringify(lean, null, 2))
      return { success: true, filePath }
        } catch (error) { return { success: false, error: error.message } }
  })


  ipcMain.handle('load-project', async (_, filePath) => {
        try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (raw.type !== 'ACT_PROJECT') return null
      const data = migrateProjectSchema(raw, filePath)
      if (data.targets) {
        data.targets = data.targets.map(t => ({
          ...t,
          fileTree: t.folderPath ? buildFileTree(t.folderPath) : []
        }))
      }
      return { data, filePath }
    } catch { return null }
  })


  ipcMain.handle('open-project-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'ACT Project', extensions: ['actproject'] }]
    })
        if (canceled) return null
        try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'))
      if (raw.type !== 'ACT_PROJECT') return null
      const data = migrateProjectSchema(raw, filePaths[0])
      if (data.targets) {
        data.targets = data.targets.map(t => ({
          ...t,
          fileTree: t.folderPath ? buildFileTree(t.folderPath) : []
        }))
      }
      return { data, filePath: filePaths[0] }
    } catch { return null }
  })


  // ── Recent projects ───────────────────────────────────────────────────────
  const recentPath = join(app.getPath('userData'), 'recent-projects.json')

  ipcMain.handle('get-recent-projects', async () => {
    try {
      const data = JSON.parse(fs.readFileSync(recentPath, 'utf-8'))
      return (data.projects || []).filter(p => fs.existsSync(p.filePath))
    } catch { return [] }
  })

  ipcMain.handle('add-recent-project', async (_, { filePath, projectName }) => {
    try {
      let data = { projects: [] }
      try { data = JSON.parse(fs.readFileSync(recentPath, 'utf-8')) } catch {}
      data.projects = [{ filePath, projectName }, ...data.projects.filter(p => p.filePath !== filePath && p.projectName !== projectName)].slice(0, 10)
      fs.writeFileSync(recentPath, JSON.stringify(data, null, 2))
      return data.projects
    } catch { return [] }
  })

  // ── Subfolder management ──────────────────────────────────────────────────
  ipcMain.handle('ensure-subfolder', async (_, { knowledgePath, subfolderName }) => {
    try {
      const subfolderPath = join(knowledgePath, subfolderName)
      if (!fs.existsSync(subfolderPath)) fs.mkdirSync(subfolderPath, { recursive: true })
      return subfolderPath
    } catch { return knowledgePath }
  })

  // ── Output version scanning ───────────────────────────────────────────────
  ipcMain.handle('scan-output-version', async (_, { folderPath, projectName, targetClass }) => {
    try {
      const sName = projectName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
      const sClass = targetClass ? targetClass.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') + '_' : ''
      const prefix = `${sName}_${sClass}file_matrix_v`
      const files = fs.existsSync(folderPath) ? fs.readdirSync(folderPath) : []
      const versions = files
        .filter(f => f.startsWith(prefix) && f.endsWith('.xml'))
        .map(f => { const m = f.match(/v(\d+)\.xml$/); return m ? parseInt(m[1]) : 0 })
      return versions.length > 0 ? Math.max(...versions) + 1 : 1
    } catch { return 1 }
  })

  // ── .repomixignore ────────────────────────────────────────────────────────
  ipcMain.handle('write-repomixignore', async (_, { folderPath, ignorePatterns }) => {
    try {
      const relative = ignorePatterns.map(p => p.startsWith(folderPath) ? p.slice(folderPath.length + 1) : p)
      const filePath = join(folderPath, '.repomixignore')
      fs.writeFileSync(filePath, relative.join('\n'))
      return { success: true, filePath }
    } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('parse-repomixignore', async (_, filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    } catch { return [] }
    })

  // ── Command execution ─────────────────────────────────────────────────────
    ipcMain.on('execute-command', (event, payload) => {
  const command = typeof payload === 'string' ? payload : payload.command
  const cwd = typeof payload === 'string' ? undefined : payload.cwd
  const projectFilePath = typeof payload === 'string' ? undefined : payload.projectFilePath
  const proc = exec(command, { env: { ...process.env }, ...(cwd ? { cwd } : {}) })
  proc.stderr.on('data', (data) => event.reply('terminal-data', `[stderr] ${data.toString()}`))
  proc.on('close', (code) => {
        if (code === 0) {
      const outputMatch = command.match(/--output\s+"([^"]+)"/)
      if (outputMatch && outputMatch[1].endsWith('.xml')) {
        try {
                    annotateMatrix(outputMatch[1], projectFilePath)
          event.reply('terminal-data', `[MATRIX] Line numbers injected.\n`)
          scanDependencies(outputMatch[1], projectFilePath)
          event.reply('terminal-data', `[MATRIX] Dependency scan complete.\n`)
                    serializeToYAML(outputMatch[1], projectFilePath)
          event.reply('terminal-data', `[MATRIX] YAML serialized.\n`)
          generateRelationalAudit(outputMatch[1], projectFilePath)
          event.reply('terminal-data', `[MATRIX] Context Lattice written.\n`)
        } catch (e) {
          event.reply('terminal-data', `[MATRIX] Annotation failed: ${e.message}\n`)
        }
      }
      event.reply('terminal-data', `✓ Done\n`)
    } else {
      event.reply('terminal-data', `\n[✗ Failed with exit code ${code}]\n`)
    }
    })
})

  // ── Runtime dependency check ──────────────────────────────────────────────
  ipcMain.handle('check-runtime-deps', async () => {
    const check = (cmd) => new Promise((resolve) => {
      exec(cmd, (err, stdout) => {
        const version = stdout.trim().split('\n')[0] || ''
        resolve({ available: !err, version: err ? null : version })
      })
    })
    const [node, python3, pip3, postgres] = await Promise.all([
      check('node --version'),
      check('python3 --version'),
      check('pip3 --version'),
      check('pg_isready --version')
    ])
                return { node, python3, pip3, postgres }
  })

      // ── DevKit disk-state verification ───────────────────────────────────────
  ipcMain.handle('verify-devkit-installed', async (_, { rootPath, packages }) => {
        const verified = []
    console.log('[verify-devkit] rootPath:', rootPath, '| packages:', packages?.length)
    try {
      // npm — parse package.json deps/devDeps as ground truth
      const npmInstalled = new Set()
      const pkgJsonPath = join(rootPath, 'package.json')
      console.log('[verify-devkit] pkgJsonPath exists:', fs.existsSync(pkgJsonPath))
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
        const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies }
        Object.keys(allDeps).forEach(k => npmInstalled.add(k))
      }
      // pip — parse requirements.txt then fall back to pip freeze
      const pipInstalled = new Set()
      const reqPath = join(rootPath, 'requirements.txt')
      if (fs.existsSync(reqPath)) {
        fs.readFileSync(reqPath, 'utf-8').split('\n')
          .map(l => l.split(/[=><!]/)[0].trim().toLowerCase())
          .filter(Boolean)
          .forEach(k => pipInstalled.add(k))
      }
      await new Promise(resolve => exec('pip3 freeze', (err, stdout) => {
        if (!err) stdout.split('\n')
          .map(l => l.split('==')[0].trim().toLowerCase())
          .filter(Boolean)
          .forEach(k => pipInstalled.add(k))
        resolve()
      }))
      for (const pkg of packages) {
        if (pkg.type === 'npm' && npmInstalled.has(pkg.id)) verified.push(pkg.id)
        else if (pkg.type === 'pip' && pipInstalled.has(pkg.id.toLowerCase())) verified.push(pkg.id)
        else if (pkg.type === 'shell') verified.push(pkg.id)
      }
    } catch { /* non-fatal */ }
    return { verified }
  })

  // ── Matrix utilities ──────────────────────────────────────────────────────
  ipcMain.handle('get-file-mtime', async (_, filePath) => {
        try {
      return { success: true, mtime: fs.statSync(filePath).mtime.toISOString() }
    } catch { return { success: false, mtime: null } }
  })

  ipcMain.handle('read-matrix-header', async (_, xmlPath) => {
    try {
      const line = fs.readFileSync(xmlPath, 'utf-8').split('\n')[0]
      const m = line.match(/generated=([^|>]+)/)
      return { success: true, generated: m ? m[1].trim() : null }
    } catch { return { success: false, generated: null } }
  })

  // ── Restore — Staged Swap Protocol ───────────────────────────────────────
  ipcMain.handle('stage-restore', async (_, { xmlPath, projectFilePath }) => {
    let stagingPath = null
    try {
      const proj = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
      const projectRoot = proj.rootPath
      if (!projectRoot) return { success: false, error: 'Project rootPath not set.' }
      stagingPath = join(projectRoot, '.act_restore_staging')

      // Parse header
      const xml = fs.readFileSync(xmlPath, 'utf-8')
      const headerMatch = xml.match(/<!-- ACT Matrix \| version=(\d+)/)
      if (!headerMatch) return { success: false, error: 'Invalid ACT Matrix header — version not found.' }
      const uploadedVersion = parseInt(headerMatch[1])
      const currentVersion = proj.matrixVersion ?? 0
      const direction =
        uploadedVersion < currentVersion ? 'ROLLBACK'
        : uploadedVersion > currentVersion ? 'UPDATE'
        : 'RESTORE'

      // Extract files
      if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true })
      fs.mkdirSync(stagingPath, { recursive: true })
      const fileRe = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
      let match
      while ((match = fileRe.exec(xml)) !== null) {
        const relPath = match[1]
        // Strip injected line numbers: "   42| content" → "content"
        const body = match[2].replace(/^\s*\d+\| ?/gm, '')
        const dest = join(stagingPath, relPath)
        fs.mkdirSync(join(dest, '..'), { recursive: true })
                fs.writeFileSync(dest, body, 'utf-8')
      }

      // Symlink live node_modules for instant stack access
      try {
        const liveModules = join(projectRoot, 'node_modules')
        const stagingModules = join(stagingPath, 'node_modules')
        if (fs.existsSync(liveModules) && !fs.existsSync(stagingModules)) {
          fs.symlinkSync(liveModules, stagingModules, 'dir')
        }
      } catch { /* non-fatal — test step will surface missing modules */ }

      // Dep scan on staging
      const stagingDeps = []
      try {
        const found = new Set()
        const jsRe = /(?:import\s+[\s\S]*?\s+from\s+['"]([^'"./][^'"]*?)['"]|require\(['"]([^'"./][^'"]*?)['"]\))/g
        let m2
        while ((m2 = jsRe.exec(xml)) !== null) {
          const raw = (m2[1] || m2[2]).split('/')[0]
          if (raw) found.add(raw)
        }
        const pyRe = /(?:^import\s+(\S+)|^from\s+(\S+)\s+import)/gm
        while ((m2 = pyRe.exec(xml)) !== null) {
          const raw = (m2[1] || m2[2]).split('.')[0]
          if (raw) found.add(raw)
        }
        stagingDeps.push(...found)
      } catch { /* non-fatal */ }

      return {
        success: true,
        uploadedVersion,
        currentVersion,
        direction,
        stagingPath,
        stagingDeps,
        currentInstalled: proj.devKit?.installed || []
      }
    } catch (e) {
      if (stagingPath && fs.existsSync(stagingPath)) {
        try { fs.rmSync(stagingPath, { recursive: true, force: true }) } catch {}
      }
      return { success: false, error: e.message }
        }
  })

  ipcMain.handle('validate-restore', (event, { stagingPath }) => {
    try {
      const modulesPath = join(stagingPath, 'node_modules')
      const linked = fs.existsSync(modulesPath)
      event.sender.send('terminal-data', linked
        ? '[STACK] Live node_modules linked — stack ready.\n'
        : '[STACK] Warning: node_modules not found in staging — app may fail to launch.\n'
      )
      return { success: true, linked }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('apply-restore', async (_, { projectRoot, stagingPath }) => {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = `${projectRoot}.act_backup_${ts}`
      fs.renameSync(projectRoot, backupPath)
      fs.renameSync(stagingPath, projectRoot)
      fs.rmSync(backupPath, { recursive: true, force: true })
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('abort-restore', async (_, { stagingPath }) => {
    try {
      if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true })
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── OAuth ─────────────────────────────────────────────────────────────────
  ipcMain.handle('get-oauth-status', async () => {
    try {
      const configPath = oauthConfigPath()
      if (!fs.existsSync(configPath)) return { hasToken: false, clientId: null }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return { hasToken: !!(config.accessToken && config.refreshToken), clientId: config.clientId || null }
    } catch { return { hasToken: false, clientId: null } }
  })

  ipcMain.handle('parse-client-secret-file', async (_, filePath) => {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const creds = data.installed || data.web
      if (!creds) return { success: false, error: 'Invalid client_secret.json format' }
      return { success: true, clientId: creds.client_id, clientSecret: creds.client_secret }
    } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('start-oauth-flow', async (_, { clientId, clientSecret }) => {
    try {
      const verifier = crypto.randomBytes(64).toString('base64url')
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
      const redirectUri = 'http://localhost:9847'

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/spreadsheets.readonly')
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')

      const code = await new Promise((resolve, reject) => {
        let authWin = new BrowserWindow({
          width: 900, height: 680,
          parent: mainWindow, modal: false,
          title: 'Connect Google Account — ACT Build Controller',
          autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        })
        const handleRedirect = (event, url) => {
          if (!url.startsWith(redirectUri)) return
          event.preventDefault()
          const parsed = new URL(url)
          const oauthCode = parsed.searchParams.get('code')
          const error = parsed.searchParams.get('error')
          authWin.removeAllListeners('closed')
          authWin.close()
          authWin = null
          if (error) reject(new Error(error))
          else if (oauthCode) resolve(oauthCode)
        }
        authWin.webContents.on('will-redirect', handleRedirect)
        authWin.webContents.on('will-navigate', handleRedirect)
        authWin.on('closed', () => { authWin = null; reject(new Error('Authentication cancelled')) })
        authWin.loadURL(authUrl.toString())
        setTimeout(() => {
          if (authWin && !authWin.isDestroyed()) authWin.close()
          reject(new Error('OAuth timeout after 5 minutes'))
        }, 300000)
      })
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }).toString()
      })
      const tokens = await tokenRes.json()
      if (tokens.error) throw new Error(tokens.error_description || tokens.error)
      const config = { clientId, clientSecret, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in * 1000) }
      fs.writeFileSync(oauthConfigPath(), JSON.stringify(config, null, 2))
      return { success: true }
    } catch (error) { return { success: false, error: error.message } }
  })
  // ── Sheet Tracker — validation & fetch ────────────────────────────────────
  ipcMain.handle('validate-sheet-id', async (_, sheetId) => {
    try {
      const token = await getValidAccessToken()
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (data.error) return { valid: false, error: data.error.message }
      return { valid: true, title: data.properties?.title || sheetId }
    } catch (error) { return { valid: false, error: error.message } }
  })

  ipcMain.handle('fetch-sheet-data', async (_, { group, knowledgePath }) => {
    try {
      const token = await getValidAccessToken()
      const subfolderPath = join(knowledgePath, toSheetSubfolder(group.label))
      if (!fs.existsSync(subfolderPath)) fs.mkdirSync(subfolderPath, { recursive: true })

      const results = []
      for (const sheet of group.sheetIds) {
        mainWindow.webContents.send('terminal-data', `Fetching: ${sheet.label || sheet.id}...\n`)
        try {
          const res = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}?fields=sheets.properties.title,sheets.properties.index`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          const data = await res.json()
          if (data.error) {
            results.push({ ...sheet, tabs: null, error: data.error.message })
            mainWindow.webContents.send('terminal-data', `  ✗ ${data.error.message}\n`)
          } else {
            const tabs = (data.sheets || [])
              .sort((a, b) => a.properties.index - b.properties.index)
              .map(s => s.properties.title)
            results.push({ ...sheet, tabs })
            mainWindow.webContents.send('terminal-data', `  ✓ ${tabs.length} tabs\n`)
          }
        } catch (err) {
          results.push({ ...sheet, tabs: null, error: err.message })
          mainWindow.webContents.send('terminal-data', `  ✗ ${err.message}\n`)
        }
        await new Promise(r => setTimeout(r, 500))
      }

      const safeLabel = group.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const outputFile = join(subfolderPath, `${safeLabel}_sheet_matrix.json`)
      const output = { generated_at: new Date().toISOString(), group: group.label, spreadsheets: results }
      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2))
      mainWindow.webContents.send('terminal-data', `\n✓ Written to ${outputFile}\n`)
      return { success: true, outputFile }
    } catch (error) {
      mainWindow.webContents.send('terminal-data', `\n✗ Error: ${error.message}\n`)
      return { success: false, error: error.message }
    }
  })

  // ── Sheet Tracker — script generation ────────────────────────────────────
  ipcMain.handle('generate-sheet-script', async (_, { group, knowledgePath }) => {
    try {
      const safeLabel = group.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const subfolderPath = join(knowledgePath, toSheetSubfolder(group.label))
      const scriptPath = join(knowledgePath, `generate_${safeLabel}_matrix.py`)

      const spreadsheetsList = group.sheetIds
        .map(s => `    {"id": "${s.id}", "label": "${(s.label || s.id).replace(/"/g, '\\"')}"}`)
        .join(',\n')

      const script = `"""
generate_${safeLabel}_matrix.py
Generated by ACT Build Controller — ${new Date().toISOString()}
Group: ${group.label}
"""

import os, json
from datetime import datetime, timezone
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

TOKEN_PATH         = os.environ.get("TOKEN_PATH", "token.json")
CLIENT_SECRET_PATH = os.environ.get("CLIENT_SECRET_PATH", "client_secret.json")
OUTPUT_DIR         = r"${subfolderPath}"
OUTPUT_PATH        = os.path.join(OUTPUT_DIR, "${safeLabel}_sheet_matrix.json")
SCOPES             = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

SPREADSHEETS = [
${spreadsheetsList}
]


def get_credentials(reauth=False):
    creds = None
    if not reauth and os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "w") as f:
            json.dump({
                "token": creds.token, "refresh_token": creds.refresh_token,
                "token_uri": creds.token_uri, "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scopes": list(creds.scopes or SCOPES)
            }, f)
    return creds


def main():
    creds   = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    matrix  = {"generated_at": datetime.now(timezone.utc).isoformat(), "group": "${group.label}", "spreadsheets": []}

    for entry in SPREADSHEETS:
        print(f"Fetching: {entry['label']}")
        try:
            result = service.spreadsheets().get(
                spreadsheetId=entry["id"],
                fields="sheets.properties.title,sheets.properties.index"
            ).execute()
            sheets = sorted(result.get("sheets", []), key=lambda s: s["properties"].get("index", 0))
            tabs = [s["properties"]["title"] for s in sheets]
            print(f"  ✓ {len(tabs)} tabs")
            matrix["spreadsheets"].append({"id": entry["id"], "label": entry["label"], "tabs": tabs})
        except HttpError as e:
            print(f"  ✗ {e}")
            matrix["spreadsheets"].append({"id": entry["id"], "label": entry["label"], "tabs": None, "error": str(e)})

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(matrix, f, indent=2, ensure_ascii=False)
    print(f"\\n✅  Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
`
      fs.writeFileSync(scriptPath, script)
      return { success: true, scriptPath }
    } catch (error) { return { success: false, error: error.message } }
  })

  // ── Sheet Tracker — script import ────────────────────────────────────────
  ipcMain.handle('import-sheet-script', async (_, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const groups = []

      // Pattern 1: PROJECT_SPREADSHEETS = [{"id": "...", "label": "..."}, ...]
      const flatMatch = content.match(/PROJECT_SPREADSHEETS\s*=\s*\[([\s\S]*?)\]/m)
      if (flatMatch) {
        const entries = [...flatMatch[1].matchAll(/"id"\s*:\s*"([^"]+)"[^}]*?"label"\s*:\s*"([^"]+)"/gs)]
        if (entries.length > 0) {
          groups.push({
            id: `g${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            label: 'Imported',
            sheetIds: entries.map(m => ({ id: m[1], label: m[2], validated: false })),
            importedScript: filePath
          })
        }
      }

      // Pattern 2: DICT_NAME_SHEET_IDS = {"KEY": "ID", ...}
      const dictMatches = [...content.matchAll(/([A-Z][A-Z0-9_]*SHEET_IDS?)\s*=\s*\{([\s\S]*?)\}/gm)]
      for (const match of dictMatches) {
        const dictName = match[1]
        const label = dictName
          .replace(/_SHEET_IDS?$/, '').replace(/_/g, ' ').toLowerCase()
          .replace(/\b\w/g, c => c.toUpperCase())
        const entries = [...match[2].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)]
        if (entries.length > 0) {
          groups.push({
            id: `g${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            label,
            sheetIds: entries.map(m => ({ id: m[2], label: m[1], validated: false })),
            importedScript: filePath
          })
        }
      }

      return { success: true, groups }
    } catch (error) { return { success: false, error: error.message } }
  })

  // ── Collaboration tokens ──────────────────────────────────────────────────
  ipcMain.handle('generate-collab-token', async (_, { projectFilePath, ownerId }) => {
    try {
      const project = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
      if (project.ownerId !== ownerId) return { success: false, error: 'Not the project owner' }
      const token = crypto.randomBytes(8).toString('hex')
      if (!project.collaborationTokens) project.collaborationTokens = []
      project.collaborationTokens.push({ token, createdAt: new Date().toISOString(), used: false })
      fs.writeFileSync(projectFilePath, JSON.stringify(project, null, 2))
      return { success: true, token }
    } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('revoke-collaborator', async (_, { projectFilePath, ownerId, collaboratorId }) => {
    try {
      const project = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'))
      if (project.ownerId !== ownerId) return { success: false, error: 'Not the project owner' }
      project.allowedUsers = (project.allowedUsers || []).filter(id => id !== collaboratorId)
      fs.writeFileSync(projectFilePath, JSON.stringify(project, null, 2))
      return { success: true }
    } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('redeem-collab-token', async (_, { token, userId }) => {
    try {
      const recentPath = join(app.getPath('userData'), 'recent-projects.json')
      let known = []
      try { known = JSON.parse(fs.readFileSync(recentPath, 'utf-8')).projects || [] } catch {}
      for (const entry of known) {
        if (!entry.filePath || !fs.existsSync(entry.filePath)) continue
        try {
          const project = JSON.parse(fs.readFileSync(entry.filePath, 'utf-8'))
          if (!project.collaborationTokens) continue
          const match = project.collaborationTokens.find(t => t.token === token && !t.used)
          if (!match) continue
          match.used = true
          if (!project.allowedUsers) project.allowedUsers = []
          fs.writeFileSync(entry.filePath, JSON.stringify(project, null, 2))
          return { success: true, filePath: entry.filePath, projectName: project.name }
        } catch { continue }
      }
      return { success: false, error: 'Token not found or already used' }
    } catch (error) { return { success: false, error: error.message } }
  })
  
    // ── Directory Builder ──────────────────────────────────────────────────────
  ipcMain.handle('create-project-directory', async (_, { projectName, projectType, destination, folders, targets }) => {
    try {
      const folderName = projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const knowledgeName = `${folderName}-knowledge`
      const projectRoot = join(destination, folderName)
      const knowledgeRoot = join(destination, knowledgeName)

      fs.mkdirSync(projectRoot, { recursive: true })
      for (const folder of folders) {
        fs.mkdirSync(join(projectRoot, folder), { recursive: true })
      }
      fs.mkdirSync(knowledgeRoot, { recursive: true })

      for (const target of targets) {
        fs.writeFileSync(join(target.folderPath, '.repomixignore'), target.ignorePatterns.join('\n'))
      }

      const gitignore = 'node_modules/\ndist/\nout/\nbuild/\n.venv/\n__pycache__/\n*.pyc\n.pytest_cache/\n*.egg-info/\n*.log\n.DS_Store\nmodules/\n'
      fs.writeFileSync(join(projectRoot, '.gitignore'), gitignore)

      const date = new Date().toISOString().split('T')[0]
      const readme = `# ${projectName}\n\nCreated with ACT Build Controller — ${date}\n\n## Project Structure\n\n${folderName}/          ← source code root\n${knowledgeName}/ ← ACT knowledge base (not committed)\n`
      fs.writeFileSync(join(projectRoot, 'docs', 'README.md'), readme)

            const safe = projectName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const projectFilePath = join(knowledgeRoot, `${safe}_matrices.actproject`)

      const projectData = {
        type: 'ACT_PROJECT',
        name: projectName,
        rootPath: projectRoot,
        knowledgePath: knowledgeRoot,
        knowledgeAbsolute: true,
        matrixVersion: 0,
        matrixHistory: [],
        targets: targets.map(t => ({
          id: t.id,
          isRoot: t.isRoot,
          class: t.class,
          folderPath: t.folderPath,
          outputPath: null,
          fileTree: [],
          ignorePatterns: [],
          repomixIgnoreFile: join(t.folderPath, '.repomixignore'),
          repomixIgnorePatterns: t.ignorePatterns
        })),
        dbTargets: [],
        devKit: { selections: [], installed: [], pending: [], activeDependencies: [] },
        databaseType: null,
                sheetTracker: { enabled: false, groups: [] }
      }

      fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2))
      const richTargets = projectData.targets.map(t => ({
        ...t,
        fileTree: t.folderPath ? buildFileTree(t.folderPath) : []
      }))
      return { success: true, projectFilePath, projectData: { ...projectData, targets: richTargets } }
    } catch (error) { return { success: false, error: error.message } }
  })

  // ── Bloat Advisor ──────────────────────────────────────────────────────────
  const BLOAT_THRESHOLD = 900 * 1024
  const STACK_DIRS = ['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'out', 'build', '.pytest_cache']

  ipcMain.handle('scan-bloat', async (_, { outputFile, folderPath, ignorePatterns }) => {
    try {
      const size = fs.statSync(outputFile).size
      if (size <= BLOAT_THRESHOLD) return { triggered: false }
      const entries = fs.readdirSync(folderPath, { withFileTypes: true })
      const unignored = entries.find(e => {
        if (!e.isDirectory()) return false
        const isStack = STACK_DIRS.includes(e.name) || e.name.endsWith('.egg-info')
        const isIgnored = ignorePatterns.some(p => p.replace(/^\//, '').replace(/\/$/, '') === e.name)
        return isStack && !isIgnored
            })
      if (!unignored) return { triggered: false }
      return { triggered: true, folderName: unignored.name, size }
    } catch { return { triggered: false } }
  })

  // ── GitHub & Release ──────────────────────────────────────────────────────
  const githubPatsPath = () => join(app.getPath('userData'), 'act-github-pats.json')
  const readGithubPats = () => { try { return JSON.parse(fs.readFileSync(githubPatsPath(), 'utf-8')) } catch { return {} } }
  const writeGithubPats = (data) => fs.writeFileSync(githubPatsPath(), JSON.stringify(data, null, 2))

  ipcMain.handle('save-github-pat', async (_, { userId, pat }) => {
    try {
      const enc = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(pat).toString('base64')
        : Buffer.from(pat).toString('base64')
      const pats = readGithubPats()
      pats[userId] = enc
      writeGithubPats(pats)
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('get-github-pat', async (_, userId) => {
    try {
      const pats = readGithubPats()
      if (!pats[userId]) return { pat: null }
      const raw = Buffer.from(pats[userId], 'base64')
      const pat = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString('utf-8')
      return { pat }
    } catch { return { pat: null } }
  })

  ipcMain.handle('test-github-connection', async (_, { pat }) => {
    return new Promise((resolve) => {
      const req = https.request({ hostname: 'api.github.com', path: '/user', headers: { Authorization: `token ${pat}`, 'User-Agent': 'ACT-Build-Controller' } }, (res) => {
        let body = ''
        res.on('data', d => { body += d })
        res.on('end', () => {
          try {
            const user = JSON.parse(body)
            if (res.statusCode !== 200) return resolve({ success: false, error: user.message || 'Auth failed' })
            resolve({ success: true, login: user.login, avatarUrl: user.avatar_url })
          } catch { resolve({ success: false, error: 'Parse error' }) }
        })
      })
            req.on('error', e => resolve({ success: false, error: e.message }))
      req.end()
    })
  })

  ipcMain.handle('generate-github-workflow', async (_, { projectPath }) => {
    try {
      const workflowDir = join(projectPath, '.github', 'workflows')
      if (!fs.existsSync(workflowDir)) fs.mkdirSync(workflowDir, { recursive: true })
      const workflowPath = join(workflowDir, 'release.yml')
      const workflow = [
        'name: Release Build',
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      version:',
        '        description: Release version',
        '        required: true',
        '      release_title:',
        '        description: Release title',
        '        required: false',
        '        default: ""',
        '      release_notes:',
        '        description: Release notes',
        '        required: false',
        '        default: ""',
        'jobs:',
        '  build:',
        '    strategy:',
        '      fail-fast: false',
        '      matrix:',
        '        os: [ubuntu-latest, windows-latest, macos-latest]',
        '    runs-on: ${{ matrix.os }}',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 24',
        '      - run: npm ci',
        '      - run: npm run build',
        '      - name: Build Electron packages',
        '        env:',
        '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
        '        run: npx electron-builder --publish never',
                '      - uses: actions/upload-artifact@v4',
        '        with:',
        '          name: release-${{ matrix.os }}',
        '          path: |',
        '            dist/*.exe',
        '            dist/*.dmg',
        '            dist/*.AppImage',
        '            dist/*.deb',
        '          if-no-files-found: error',
        '  release:',
        '    needs: build',
        '    runs-on: ubuntu-latest',
        '    permissions:',
        '      contents: write',
        '    steps:',
                '      - uses: actions/download-artifact@v4',
        '        with:',
        '          merge-multiple: true',
        '          path: dist',
                                '      - name: Create Release',
        '        uses: softprops/action-gh-release@v2',
        '        with:',
        '          tag_name: v${{ github.event.inputs.version }}',
        '          name: ${{ github.event.inputs.release_title }}',
        '          body: ${{ github.event.inputs.release_notes }}',
        '          files: |',
        '            dist/*.exe',
        '            dist/*.dmg',
        '            dist/*.AppImage',
        '            dist/*.deb',
        '          overwrite_files: true',
        '        env:',
        '          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
      ].join('\n')
            fs.writeFileSync(workflowPath, workflow)
      return { success: true, path: workflowPath }
        } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('dispatch-github-workflow', async (_, { pat, owner, repo, version, releaseTitle, releaseNotes }) => {
    return new Promise((resolve) => {
      const listReq = https.request({ hostname: 'api.github.com', path: `/repos/${owner}/${repo}/actions/workflows`, headers: { Authorization: `token ${pat}`, 'User-Agent': 'ACT-Build-Controller' } }, (listRes) => {
        let listRaw = ''
        listRes.on('data', d => { listRaw += d })
        listRes.on('end', () => {
          let workflowId = null
          try {
            const data = JSON.parse(listRaw)
            const wf = data.workflows?.find(w => w.path === '.github/workflows/release.yml')
            workflowId = wf?.id || null
          } catch {}
          if (!workflowId) return resolve({ success: false, error: 'Workflow not found on remote' })
          const body = JSON.stringify({ ref: 'main', inputs: { version, release_title: releaseTitle || '', release_notes: releaseNotes || '' } })
          const req = https.request({ hostname: 'api.github.com', method: 'POST', path: `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, headers: { Authorization: `token ${pat}`, 'User-Agent': 'ACT-Build-Controller', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
            let raw = ''
            res.on('data', d => { raw += d })
            res.on('end', () => {
              if (res.statusCode === 204) return resolve({ success: true })
              try { resolve({ success: false, error: JSON.parse(raw)?.message || `HTTP ${res.statusCode}` }) } catch { resolve({ success: false, error: `HTTP ${res.statusCode}` }) }
            })
          })
          req.on('error', e => resolve({ success: false, error: e.message }))
          req.write(body)
          req.end()
        })
      })
      listReq.on('error', e => resolve({ success: false, error: e.message }))
      listReq.end()
    })
  })

  ipcMain.handle('poll-github-run', async (_, { pat, owner, repo }) => {
    return new Promise((resolve) => {
      const req = https.request({ hostname: 'api.github.com', path: `/repos/${owner}/${repo}/actions/runs?per_page=1`, headers: { Authorization: `token ${pat}`, 'User-Agent': 'ACT-Build-Controller' } }, (res) => {
        let body = ''
        res.on('data', d => { body += d })
        res.on('end', () => {
          try {
            const data = JSON.parse(body)
            const run = data.workflow_runs?.[0]
            resolve(run ? { id: run.id, status: run.status, conclusion: run.conclusion, url: run.html_url } : { status: 'none' })
          } catch { resolve({ status: 'error' }) }
        })
      })
      req.on('error', () => resolve({ status: 'error' }))
      req.end()
    })
  })

  ipcMain.handle('get-package-version', async (_, projectPath) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(join(projectPath, 'package.json'), 'utf-8'))
      return { version: pkg.version }
    } catch { return { version: null } }
  })

  ipcMain.handle('bump-package-version', async (_, { projectPath, version }) => {
    try {
      const pkgPath = join(projectPath, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      pkg.version = version
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('patch-electron-builder-mac', async (_, { projectPath }) => {
    try {
      const cfgPath = join(projectPath, 'electron-builder.yml')
      let content = fs.readFileSync(cfgPath, 'utf-8')
      if (content.includes('\nmac:')) return { success: true, alreadyPresent: true }
            content += '\nmac:\n  target:\n    - target: dmg\n      arch: [x64, arm64]\n  artifactName: ${productName}-${version}-${arch}.dmg\n'
      fs.writeFileSync(cfgPath, content)
      return { success: true, alreadyPresent: false }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('get-git-remote', async (_, projectPath) => {
    return new Promise((resolve) => {
      exec('git remote get-url origin', { cwd: projectPath }, (err, stdout) => {
        if (err) return resolve({ url: null })
        const url = stdout.trim()
        const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/)
        resolve(m ? { url, owner: m[1], repo: m[2] } : { url, owner: null, repo: null })
      })
    })
  })

  ipcMain.handle('update-package-homepage', async (_, { projectPath, homepage }) => {
    try {
      const pkgPath = join(projectPath, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      pkg.homepage = homepage
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('log-error', async (_, { message, stack, component }) => {
    const logPath = join(app.getPath('userData'), 'act-error.log')
                        const entry = `\n[${new Date().toISOString()}] COMPONENT: ${component}\nMESSAGE: ${message}\nSTACK:\n${stack}\n${'─'.repeat(80)}`
    fs.appendFileSync(logPath, entry)
        return { logPath }
  })

      ipcMain.handle('commit-push-workflow', async (_, { projectPath, pat, owner, repo }) => {
    if (!fs.existsSync(join(projectPath, '.github', 'workflows', 'release.yml'))) return { success: false, error: 'Workflow file not found locally' }
    return new Promise((resolve) => {
      const remote = `https://${pat}@github.com/${owner}/${repo}.git`
      const run = (cmd, cb) => exec(cmd, { cwd: projectPath }, cb)
      run('git add -A', (e1) => {
        if (e1) return resolve({ success: false, error: e1.message })
        run('git diff --cached --quiet', (e2) => {
          const hasChanges = !!e2
          const push = () => run(`git push "${remote}" HEAD:main`, (e3) => {
            if (e3) return resolve({ success: false, error: e3.message })
            resolve({ success: true })
          })
          if (!hasChanges) return push()
          run(`git commit -m "release: v${require(join(projectPath, 'package.json')).version}"`, (e4) => {
            if (e4) return resolve({ success: false, error: e4.message })
            push()
          })
        })
      })
    })
  })

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
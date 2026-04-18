import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { exec } from 'child_process'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
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

// ── Code Patcher — hunk apply engine ─────────────────────────────────────────
function applyHunks(fileContent, hunks) {
  let text = fileContent.replace(/\r\n/g, '\n')

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

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
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

function annotateMatrix(filePath) {
 const content = fs.readFileSync(filePath, 'utf-8')
 const annotated = content.replace(
    /(<file path="[^"]+">)([\s\S]*?)(<\/file>)/g,
    (_, open, body, close) => {
      const lines = body.split('\n')
      if (lines[1] && /^\s*\d+\|/.test(lines[1])) return _ // already annotated
      const numbered = lines.map((line, i) => {
        if (i === 0 || i === lines.length - 1) return line
        return `${String(i).padStart(5)}| ${line}`
      })
      return `${open}${numbered.join('\n')}${close}`
    }
  )
  fs.writeFileSync(filePath, annotated, 'utf-8')
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
    fs.writeFileSync(join(rootPath, relativePath), content, 'utf-8')
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
    const buildTree = (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true })
          .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
          .map((e) => ({
            name: e.name,
            path: join(dir, e.name),
            isDirectory: e.isDirectory(),
            children: e.isDirectory() ? buildTree(join(dir, e.name)) : []
          }))
      } catch { return [] }
    }
    try { return buildTree(rootPath) } catch { return [] }
  })

  // ── Project file operations ───────────────────────────────────────────────
  ipcMain.handle('save-project', async (_, { knowledgePath, projectName, data }) => {
    try {
      if (!fs.existsSync(knowledgePath)) fs.mkdirSync(knowledgePath, { recursive: true })
      const safe = projectName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const filePath = join(knowledgePath, `${safe}_matrices.actproject`)
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
      return { success: true, filePath }
    } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('load-project', async (_, filePath) => {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return data.type === 'ACT_PROJECT' ? { data, filePath } : null
    } catch { return null }
  })

  ipcMain.handle('open-project-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'ACT Project', extensions: ['actproject'] }]
    })
    if (canceled) return null
    try {
      const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'))
      return data.type === 'ACT_PROJECT' ? { data, filePath: filePaths[0] } : null
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
  ipcMain.on('execute-command', (event, command) => {
  const proc = exec(command, { env: { ...process.env } })
  proc.stderr.on('data', (data) => event.reply('terminal-data', `[stderr] ${data.toString()}`))
  proc.on('close', (code) => {
    if (code === 0) {
      const outputMatch = command.match(/--output\s+"([^"]+)"/)
      if (outputMatch && outputMatch[1].endsWith('.xml')) {
        try {
          annotateMatrix(outputMatch[1])
          event.reply('terminal-data', `[MATRIX] Line numbers injected.\n`)
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
        sheetTracker: { enabled: false, groups: [] }
      }

      fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2))
      return { success: true, projectFilePath, projectData }
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

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
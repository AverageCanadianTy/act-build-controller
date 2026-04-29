import { useState, useEffect, useRef } from 'react'
import FileTree from './components/FileTree'
import LoginScreen from './components/LoginScreen'
import ProjectPicker from './components/ProjectPicker'
import SheetTracker from './components/SheetTracker'
import OAuthSetup from './components/OAuthSetup'
import DirectoryBuilder from './components/DirectoryBuilder'
import CodePatcher from './components/CodePatcher'
import CollabManager from './components/CollabManager'
import DevKit from './components/DevKit'
import DatabaseConfig from './components/DatabaseConfig'
import RestoreModal from './components/RestoreModal'
import Connections from './components/Connections'
import ReleaseBuilder from './components/ReleaseBuilder'
import ErrorBoundary from './components/ErrorBoundary'
import CIStatus from './components/CIStatus'
// ── Helpers ────────────────────────────────────────────────────────────────
const toSafeName = (str) => str.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')

const toSubfolderName = (target) =>
  target.isRoot
    ? 'root-file-matrices'
    : `${target.class.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-file-matrices`

const matchesPattern = (relativePath, pattern) => {
  const clean = pattern.replace(/^\//, '').replace(/\/$/, '')
  if (relativePath === clean || relativePath.startsWith(clean + '/')) return true
  if (relativePath.split('/').includes(clean)) return true
  if (clean.startsWith('*.')) return relativePath.endsWith(clean.slice(1))
  return false
}

const matchPatternsToTree = (tree, patterns, rootPath) => {
  const matched = []
  const walk = (nodes) => {
    for (const node of nodes) {
      const relative = node.path.replace(rootPath + '/', '')
      if (patterns.some(p => matchesPattern(relative, p))) matched.push(node.path)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(tree)
  return matched
}

// Ensures loaded projects have all expected fields (backward compat)
const normalizeProject = (project) => ({
  ...project,
  sheetTracker: project.sheetTracker || { enabled: false, groups: [] },
  devKit: project.devKit || { selections: [], installed: [], pending: [], activeDependencies: [] },
  dbTargets: project.dbTargets || [],
  matrixVersion: project.matrixVersion ?? 0,
    databaseType: project.databaseType ?? null,
  matrixHistory: project.matrixHistory || [],
  runCommand: project.runCommand ?? null,
})

const timeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
// ── Exclusion Modal ────────────────────────────────────────────────────────
function ExclusionModal({ target, onToggle, onSelectAll, onDeselectAll, onClose }) {
  const getAllPaths = () => {
    const paths = []
    const walk = (nodes) => {
      for (const node of nodes) {
        paths.push(node.path)
        if (node.children?.length) walk(node.children)
      }
    }
    if (target.fileTree) walk(target.fileTree)
    return paths
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-label">Ignore Matrix</span>
            <span className="modal-domain-name">{target.isRoot ? 'Root' : target.class}</span>
          </div>
          <div className="modal-meta">
            {target.ignorePatterns.length > 0 && (
              <span className="ignore-badge">{target.ignorePatterns.length} excluded</span>
            )}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-hint">
          <strong>Checked items are excluded</strong> from repomix output. Uncheck to include.
        </div>
        <div className="modal-tree-body">
          <FileTree
            tree={target.fileTree}
            ignorePatterns={target.ignorePatterns || []}
            onToggle={onToggle}
          />
        </div>
        <div className="modal-footer">
          <button className="modal-bulk-btn" onClick={onDeselectAll}>☐ Deselect All</button>
          <button className="modal-bulk-btn" onClick={() => onSelectAll(getAllPaths())}>☑ Select All</button>
          {target.ignorePatterns.length > 0 && (
            <button
              className="modal-save-ignore-btn"
              onClick={async () => {
                const result = await window.api.writeRepomixIgnore({
                  folderPath: target.folderPath,
                  ignorePatterns: target.ignorePatterns
                })
                if (result.success) onClose()
              }}
            >
              💾 Save as .repomixignore
            </button>
          )}
          <button className="modal-done-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Add Target Modal ───────────────────────────────────────────────────────
function AddTargetModal({ onConfirm, onClose }) {
  const [className, setClassName] = useState('')
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-label">New Scan Target</span>
            <span className="modal-domain-name">Name this target</span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body-pad">
          <p className="add-target-hint">
            Give this scan target a class name. It will appear in the output filename:<br />
            <code>projectname_<strong>classname</strong>_file_matrix_v1.xml</code>
          </p>
          <input
            className="class-name-input"
            placeholder="e.g. backend, docs, scripts"
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && className.trim()) onConfirm(className.trim()) }}
            autoFocus
          />
        </div>
        <div className="modal-footer">
          <button className="modal-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="modal-done-btn"
            onClick={() => { if (className.trim()) onConfirm(className.trim()) }}
            disabled={!className.trim()}
          >
            Select Folder →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeUser, setActiveUser] = useState(null)
  const [project, setProject] = useState(null)
  const [projectFilePath, setProjectFilePath] = useState(null)
  const [activeTab, setActiveTab] = useState('architect')
  const [logs, setLogs] = useState([])
  const [modalTargetId, setModalTargetId] = useState(null)
  const [showAddTarget, setShowAddTarget] = useState(false)
    const [showOAuthSetup, setShowOAuthSetup] = useState(false)
  const [oauthStatus, setOauthStatus] = useState(null)
    const terminalRef = useRef(null)
  const [showDirectoryBuilder, setShowDirectoryBuilder] = useState(false)
  const [showCollabManager, setShowCollabManager] = useState(false)
        const [bloatAdvisory, setBloatAdvisory] = useState([])
  const [dismissedBloat, setDismissedBloat] = useState(new Set())
    const buildQueueRef = useRef([])
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const projectFilePathRef = useRef(null)
  const [driftWarning, setDriftWarning] = useState(false)
  const [releaseRunStatus, setReleaseRunStatus] = useState(null)
  const [releaseDispatching, setReleaseDispatching] = useState(false)
  const releasePollRef = useRef(null)
  const addLog = (msg) => setLogs(prev => [...prev, msg])

  // Auto-login check
  useEffect(() => {
    if (!window.api) return
    window.api.getUsers().then(users => {
      const auto = users.find(u => u.autoLogin)
      if (auto) setActiveUser(auto)
    })
  }, [])  

  // Load OAuth status on mount
  useEffect(() => {
        if (!window.api) return
    window.api.getOAuthStatus().then(setOauthStatus)
  }, [])

  // Sync projectFilePathRef for use in closures
  useEffect(() => { projectFilePathRef.current = projectFilePath }, [projectFilePath])

  useEffect(() => {
        if (!window.api) return
        const unsub = window.api.onLog(async (data) => {
      setLogs(prev => [...prev.slice(-200), data])
      if (data === '✓ Done\n') {
        const pfp = projectFilePathRef.current
        if (pfp) {
          const loaded = await window.api.loadProject(pfp)
          if (loaded.success) setProject(normalizeProject(loaded.data))
        }
        if (buildQueueRef.current.length > 0) {
          const pending = buildQueueRef.current.shift()
          const result = await window.api.scanBloat(pending)
          setBloatAdvisory(prev => {
            const filtered = prev.filter(b => b.targetId !== pending.targetId)
            return result.triggered ? [...filtered, { targetId: pending.targetId, folderName: result.folderName, size: result.size }] : filtered
          })
        }
      }
    })
    return () => { if (unsub) unsub() }
  }, [])

  useEffect(() => {
    if (terminalRef.current)
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
                setModalTargetId(null)
        setShowAddTarget(false)
                setShowOAuthSetup(false)
        setShowDirectoryBuilder(false)
        setShowCollabManager(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-save
  useEffect(() => {
    if (!project?.knowledgePath || !window.api) return
    window.api.saveProject({
      knowledgePath: project.knowledgePath,
      projectName: project.name,
      data: project
    }).then(result => {
      if (result.success && result.filePath) {
        setProjectFilePath(result.filePath)
        window.api.addRecentProject({ filePath: result.filePath, projectName: project.name })
      }
        })
  }, [project])

  // Drift check — fires on project load
  useEffect(() => {
    if (!projectFilePath || !window.api) return
    const history = project?.matrixHistory
    if (!history?.length) { setDriftWarning(false); return }
    const lastBuilt = new Date(history[history.length - 1].timestamp)
    window.api.getFileMtime(projectFilePath).then(result => {
      if (result.success && result.mtime) {
        setDriftWarning(new Date(result.mtime) > lastBuilt)
      }
    })
  }, [projectFilePath])

    const handleProjectLoaded = (loadedProject, filePath) => {
    setProject(normalizeProject(loadedProject))
    setProjectFilePath(filePath)
    setBloatAdvisory([])
    setDismissedBloat(new Set())
    if (filePath) window.api.addRecentProject({ filePath, projectName: loadedProject.name })
  }

  const updateProject = (updater) =>
    setProject(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }
      return normalizeProject(next)
    })

  const updateTarget = (targetId, updater) =>
    updateProject(prev => ({
      ...prev,
      targets: prev.targets.map(t =>
        t.id === targetId
          ? (typeof updater === 'function' ? updater(t) : { ...t, ...updater })
          : t
      )
    }))

  const handleSelectKnowledge = async () => {
    const path = await window.api.selectFolder()
    if (!path) return
    updateProject(prev => ({ ...prev, knowledgePath: path }))
  }

  const handleAddTargetConfirm = async (className) => {
    setShowAddTarget(false)
    const folderPath = await window.api.selectFolder()
    if (!folderPath) return
    const fileTree = await window.api.scanDirectory(folderPath)
    updateProject(prev => ({
      ...prev,
      targets: [...prev.targets, {
        id: `t${Date.now()}`,
        isRoot: false,
        class: className,
        folderPath,
        outputPath: null,
        fileTree,
        ignorePatterns: [],
        repomixIgnoreFile: null,
        repomixIgnorePatterns: []
      }]
    }))
  }

  const handleRemoveTarget = (targetId) =>
    updateProject(prev => ({ ...prev, targets: prev.targets.filter(t => t.id !== targetId) }))

  const handleSelectTargetFolder = async (targetId) => {
    const path = await window.api.selectFolder()
    if (!path) return
    const fileTree = await window.api.scanDirectory(path)
    updateTarget(targetId, { folderPath: path, fileTree, ignorePatterns: [], repomixIgnoreFile: null, repomixIgnorePatterns: [] })
  }

  const handleSelectTargetOutput = async (targetId) => {
    const path = await window.api.selectFolder()
    if (!path) return
    updateTarget(targetId, { outputPath: path })
  }

  const handleRepomixIgnoreUpload = async (targetId) => {
    const filePath = await window.api.selectFile([{ name: 'Repomix Ignore', extensions: ['repomixignore', 'txt', '*'] }])
    if (!filePath) return
    const patterns = await window.api.parseRepomixIgnore(filePath)
    const target = project.targets.find(t => t.id === targetId)
    const matched = target.fileTree ? matchPatternsToTree(target.fileTree, patterns, target.folderPath) : []
    updateTarget(targetId, { repomixIgnoreFile: filePath, repomixIgnorePatterns: patterns, ignorePatterns: matched })
  }

  const handleClearRepomixIgnore = (targetId) =>
    updateTarget(targetId, { repomixIgnoreFile: null, repomixIgnorePatterns: [], ignorePatterns: [] })

  const toggleIgnore = (targetId, filePath) =>
  updateTarget(targetId, prev => {
    const isCurrentlyIgnored = prev.ignorePatterns.includes(filePath)
    
    // Collect the clicked path plus all descendants if it's a directory
    const collectPaths = (paths, nodes) => {
      for (const node of nodes) {
        if (node.path === filePath || node.path.startsWith(filePath + '/')) {
          paths.push(node.path)
        }
        if (node.children?.length) collectPaths(paths, node.children)
      }
      return paths
    }
    
    const affectedPaths = prev.fileTree
      ? collectPaths([], prev.fileTree)
      : [filePath]
    
    // If nothing found in tree (shouldn't happen), fall back to just the clicked path
    if (affectedPaths.length === 0) affectedPaths.push(filePath)
    
    return {
      ...prev,
      ignorePatterns: isCurrentlyIgnored
        ? prev.ignorePatterns.filter(p => !affectedPaths.includes(p))
        : [...new Set([...prev.ignorePatterns, ...affectedPaths])]
    }
  })

  // ── Build ─────────────────────────────────────────────────────────────────
  const runTargetBuild = async (target) => {
    if (!target.folderPath) return
    const basePath = project.knowledgeAbsolute
      ? project.knowledgePath
      : (target.outputPath || project.knowledgePath)
    if (!basePath) {
      setLogs(prev => [...prev, `[ERROR] No output path configured\n`])
      return
    }
    const subfolderName = toSubfolderName(target)
    const subfolderPath = await window.api.ensureSubfolder({ knowledgePath: basePath, subfolderName })
    const nextVersion = await window.api.scanOutputVersion({
      folderPath: subfolderPath,
      projectName: project.name,
      targetClass: target.class
    })
    const sName = toSafeName(project.name)
    const sClass = target.class ? toSafeName(target.class) + '_' : ''
    const filename = `${sName}_${sClass}file_matrix_v${nextVersion}.xml`
    const outputFile = `${subfolderPath}/${filename}`
    const label = target.isRoot ? project.name : `${project.name} → ${target.class}`

    if (target.ignorePatterns?.length > 0 && !target.repomixIgnoreFile) {
      await window.api.writeRepomixIgnore({ folderPath: target.folderPath, ignorePatterns: target.ignorePatterns })
    }

                setLogs(prev => [...prev, `[${label}] Processing ${filename}...\n`])
    buildQueueRef.current.push({ targetId: target.id, outputFile, folderPath: target.folderPath, ignorePatterns: target.ignorePatterns || [] })
        window.api.runScript({ command: `cd "${target.folderPath}" && repomix --output "${outputFile}"`, projectFilePath })
  }

  const runSheetFetch = async (group) => {
    if (!project.knowledgePath) return
    const label = `${project.name} → ${group.label}`
    setLogs(prev => [...prev, `[${label}] Refreshing sheet data...\n`])
    await window.api.fetchSheetData({ group, knowledgePath: project.knowledgePath })
  }

  const runSqlExport = async (db) => {
    if (!project.knowledgePath) return
    const label = `${project.name} → ${db.label}`
    setLogs(prev => [...prev, `[${label}] Generating schema JSON...\n`])
    const fn = db.type === 'sqlite' ? window.api.generateSqliteSchema : window.api.generatePostgresSchema
    const args = db.type === 'sqlite'
      ? { dbPath: db.connectionInfo, projectName: project.name, knowledgePath: project.knowledgePath }
      : { connectionString: db.connectionInfo, projectName: project.name, knowledgePath: project.knowledgePath }
    const r = await fn(args)
    if (r.success) {
      setLogs(prev => [...prev, `[${label}] ✓ Written to ${r.outputPath}\n`])
      setProject(prev => ({ ...prev, dbTargets: prev.dbTargets.map(t => t.id === db.id ? { ...t, lastExported: new Date().toISOString() } : t) }))
    } else {
      setLogs(prev => [...prev, `[${label}] ✗ ${r.error}\n`])
    }
  }

    
    const getOutputPath = (target) =>
    project.knowledgeAbsolute ? project.knowledgePath : (target.outputPath || project.knowledgePath)

  const runAllMatrices = async () => {
    const readyTargets = project.targets.filter(t => t.folderPath && getOutputPath(t))
    if (readyTargets.length === 0) return
    setLogs(prev => [...prev, `[Context Lattice] Starting full matrix build...\n`])
    for (const target of readyTargets) {
      await new Promise((resolve) => {
        const unsub = window.api.onLog((data) => {
          if (data === '✓ Done\n' || data.startsWith('\n[✗ Failed')) {
            unsub()
            resolve()
          }
        })
        runTargetBuild(target)
      })
    }
  }

    const modalTarget = modalTargetId ? project?.targets.find(t => t.id === modalTargetId) : null
  const tracker = project?.sheetTracker || { enabled: false, groups: [] }


  const handleLogout = async () => {
    if (activeUser) await window.api.updateAutoLogin({ userId: activeUser.id, autoLogin: false })
    setActiveUser(null)
    setProject(null)
    setProjectFilePath(null)
  }

  if (!activeUser) return <LoginScreen onLogin={setActiveUser} />

if (!project) return (
    <>
      <ProjectPicker
        onProjectLoaded={handleProjectLoaded}
        onBuildNewDirectory={() => setShowDirectoryBuilder(true)}
        activeUser={activeUser}
        onLogout={handleLogout}
      />
      {showDirectoryBuilder && (
        <DirectoryBuilder
          onComplete={(projectData, filePath) => { setShowDirectoryBuilder(false); handleProjectLoaded(projectData, filePath) }}
          onClose={() => setShowDirectoryBuilder(false)}
        />
      )}
    </>
  )
  
  return (
    <main className="app-layout">
      {modalTarget && (
        <ExclusionModal
          target={modalTarget}
          onToggle={(path) => toggleIgnore(modalTargetId, path)}
          onSelectAll={(paths) => updateTarget(modalTargetId, prev => ({ ...prev, ignorePatterns: paths }))}
          onDeselectAll={() => updateTarget(modalTargetId, prev => ({ ...prev, ignorePatterns: [] }))}
          onClose={() => setModalTargetId(null)}
        />
      )}
      {showAddTarget && (
        <AddTargetModal
          onConfirm={handleAddTargetConfirm}
          onClose={() => setShowAddTarget(false)}
        />
      )}
      {showOAuthSetup && (
        <OAuthSetup
          onSuccess={async () => {
            const status = await window.api.getOAuthStatus()
            setOauthStatus(status)
            setShowOAuthSetup(false)
            // If sheet tracker was trying to enable, enable it now
            if (!tracker.enabled) updateProject(prev => ({
              ...prev,
              sheetTracker: { ...prev.sheetTracker, enabled: true }
            }))
          }}
                    onClose={() => setShowOAuthSetup(false)}
        />
      )}

      {showCollabManager && (
        <CollabManager
          projectFilePath={projectFilePath}
          activeUser={activeUser}
          onClose={() => setShowCollabManager(false)}
        />
      )}

            {showRestoreModal && (
        <RestoreModal
          project={project}
          projectFilePath={projectFilePath}
                    onClose={() => setShowRestoreModal(false)}
        />
      )}

      <nav className="sidebar">
        <div className="sidebar-project-name">{project.name}</div>
        <div className="nav-group">
          <button className={activeTab === 'architect' ? 'active' : ''} onClick={() => setActiveTab('architect')} title="Matrix Architect">
            <span className="sidebar-icon">⊞</span>
            <span className="sidebar-label">Matrix Architect</span>
          </button>
          <button className={activeTab === 'database' ? 'active' : ''} onClick={() => setActiveTab('database')} title="Database Config">
            <span className="sidebar-icon">◉</span>
            <span className="sidebar-label">Database Config</span>
          </button>
          <button className={activeTab === 'devkit' ? 'active' : ''} onClick={() => setActiveTab('devkit')} title="Dev Kit">
            <span className="sidebar-icon">⚙</span>
            <span className="sidebar-label">Dev Kit</span>
          </button>
          <button className={activeTab === 'patcher' ? 'active' : ''} onClick={() => setActiveTab('patcher')} title="Code Patcher">
            <span className="sidebar-icon">◈</span>
            <span className="sidebar-label">Code Patcher</span>
          </button>
          <button className={activeTab === 'commander' ? 'active' : ''} onClick={() => setActiveTab('commander')} title="Command Center">
            <span className="sidebar-icon">⬡</span>
            <span className="sidebar-label">Command Center</span>
          </button>
                    <button className={activeTab === 'restore' ? 'active' : ''} onClick={() => setActiveTab('restore')} title="Restore">
            <span className="sidebar-icon">↩</span>
            <span className="sidebar-label">Restore</span>
          </button>
          <button className={activeTab === 'connections' ? 'active' : ''} onClick={() => setActiveTab('connections')} title="Connections">
            <span className="sidebar-icon">⇄</span>
            <span className="sidebar-label">Connections</span>
          </button>
          <button className={activeTab === 'release' ? 'active' : ''} onClick={() => setActiveTab('release')} title="Release Builder">
            <span className="sidebar-icon">▲</span>
            <span className="sidebar-label">Release Builder</span>
          </button>
        </div>
        <button className="sidebar-share-btn" onClick={() => setShowCollabManager(true)} title="Share Project">
          <span className="sidebar-icon">👤</span>
          <span className="sidebar-label">Share Project</span>
        </button>
        <button className="sidebar-back-btn" onClick={() => { setProject(null); setProjectFilePath(null) }} title="← Projects">
          <span className="sidebar-icon">←</span>
          <span className="sidebar-label">← Projects</span>
        </button>
      </nav>

      <section className="content-area">

        {/* ── ARCHITECT ──────────────────────────────────────────────────── */}
        {activeTab === 'architect' && (
          <div className="architect-view">
            <h1>Matrix Architect</h1>

            <div className="project-settings-card">
              <div className="path-field">
                <span className="path-label">Knowledge Folder</span>
                <button onClick={handleSelectKnowledge}>{project.knowledgePath ? 'Change' : 'Select'}</button>
                <code>{project.knowledgePath || 'Not set — required before building'}</code>
              </div>
              <label className="absolute-toggle">
                <input
                  type="checkbox"
                  checked={project.knowledgeAbsolute}
                  onChange={(e) => updateProject({ knowledgeAbsolute: e.target.checked })}
                />
                <span>Use knowledge folder as output for all targets</span>
              </label>
              {projectFilePath && (
                <div className="project-file-path">
                  💾 Saved to <code>{projectFilePath}</code>
                </div>
              )}
            </div>

            {project.targets.map((target) => (
              <div key={target.id} className="domain-card">
                <div className="target-header">
                  <div className="target-title">
                    <span className="target-badge">{target.isRoot ? 'ROOT' : target.class.toUpperCase()}</span>
                    <span className="target-folder-name">
                      {target.folderPath ? target.folderPath.split('/').pop() : 'No folder selected'}
                    </span>
                  </div>
                  {!target.isRoot && (
                    <button className="target-remove-btn" onClick={() => handleRemoveTarget(target.id)}>✕</button>
                  )}
                </div>

                <div className="path-settings">
                  <div className="path-field">
                    <button onClick={() => handleSelectTargetFolder(target.id)}>
                      {target.folderPath ? 'Change Folder' : 'Select Folder'}
                    </button>
                    <code>{target.folderPath || 'Not set'}</code>
                  </div>
                  {!project.knowledgeAbsolute && (
                    <div className="path-field">
                      <button onClick={() => handleSelectTargetOutput(target.id)}>Output Folder</button>
                      <code>{target.outputPath || 'Inherits knowledge folder'}</code>
                    </div>
                  )}
                </div>

                {project.knowledgePath && (
                  <div className="subfolder-indicator">
                    📁 Outputs to <code>{toSubfolderName(target)}/</code>
                  </div>
                )}

                {target.folderPath && (
                  <div className="ignore-controls">
                    {target.repomixIgnoreFile ? (
                      <div className="repomixignore-active">
                        <span className="repomixignore-label">
                          📄 .repomixignore — {target.repomixIgnorePatterns.length} patterns, {target.ignorePatterns.length} files matched
                        </span>
                        <button className="repomixignore-clear" onClick={() => handleClearRepomixIgnore(target.id)}>
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="ignore-btn-row">
                        <button className="exclusion-btn" onClick={() => {
                          if (target.ignorePatterns.length === 0 && target.fileTree) {
                          const allPaths = []
                          const walk = (nodes) => {
                            for (const node of nodes) {
                              allPaths.push(node.path)
                              if (node.children?.length) walk(node.children)
                            }
                          }
                          walk(target.fileTree)
                          updateTarget(target.id, prev => ({ ...prev, ignorePatterns: allPaths }))
                        }
                        setModalTargetId(target.id)
                      }}>
                        🗂 Configure Exclusions
                        {target.ignorePatterns.length > 0 && (
                          <span className="exclusion-count">{target.ignorePatterns.length}</span>
                        )}
                      </button>
                      <button className="repomixignore-upload-btn" onClick={() => handleRepomixIgnoreUpload(target.id)}>
                        ↑ Upload .repomixignore
                      </button>
                    </div>
                  )}
                </div>
              )}
              {(() => {
                const advisory = bloatAdvisory.find(b => b.targetId === target.id)
                if (!advisory || dismissedBloat.has(target.id)) return null
                return (
                  <div className="bloat-banner">
                    <div className="bloat-banner-text">⚠ Matrix output is large ({(advisory.size / (1024 * 1024)).toFixed(1)}MB). {advisory.folderName}/ is not excluded from this target — this is likely causing bloat.</div>
                    <div className="bloat-banner-actions">
                      <button className="bloat-open-btn" onClick={() => setModalTargetId(target.id)}>Open Ignore Matrix →</button>
                      <button className="bloat-dismiss-btn" onClick={() => setDismissedBloat(prev => new Set([...prev, target.id]))}>Dismiss</button>
                    </div>
                  </div>
                )
              })()}
            </div>
            
          ))}

            

                        <button className="add-domain-btn" onClick={() => setShowAddTarget(true)}>
                            + Add Scan Target
            </button>
          </div>
        )}


        {/* ── COMMANDER ──────────────────────────────────────────────────── */}
        {activeTab === 'commander' && (
                    <div className="commander-view">
            <h1>Command Center</h1>

            {driftWarning && (
              <div className="drift-warning-banner">
                ⚠ Project may have changed since last matrix build.
                            </div>
            )}
            <div className="build-all-row">
              <button
                className={`build-all-btn${project.targets.some(t => t.folderPath && getOutputPath(t)) ? '' : ' run-btn-disabled'}`}
                onClick={() => project.targets.some(t => t.folderPath && getOutputPath(t)) && runAllMatrices()}
                disabled={!project.targets.some(t => t.folderPath && getOutputPath(t))}
              >
                ⬡ Build All Matrices
              </button>
            </div>
            <div className="commander-targets">
              {/* Scan targets */}
                            {project.targets.length > 0 && (
                <div className="commander-section-label">File Matrices</div>
              )}
                            {project.targets.map((target) => {
                const label = target.isRoot ? project.name : `${project.name} → ${target.class}`
                const lastBuild = (project.matrixHistory || []).at(-1)
                return (
                  <div key={target.id} className="commander-target-row">
                    <div className="commander-target-info">
                      <span className="target-badge">
                        {target.isRoot ? 'ROOT' : target.class.toUpperCase()}
                      </span>
                      <div className="commander-target-details">
                        <span className="commander-target-name">{label}</span>
                        <span className="commander-target-path">
                          {target.folderPath ? `→ ${toSubfolderName(target)}/` : 'No folder set'}
                        </span>
                        <span className="commander-target-meta">
                                                    {lastBuild ? `v${lastBuild.version} · ${timeAgo(lastBuild.timestamp)}` : 'Never built'}
                        </span>
                                            </div>
                    </div>
                  </div>
                )
              })}

              {/* Sheet groups */}
                            {tracker.enabled && tracker.groups.length > 0 && (
                <>
                  <div className="commander-section-label">Data Sources</div>
                  {tracker.groups.map((group) => {
                    const ready = !!(group.sheetIds.length > 0 && project.knowledgePath && oauthStatus?.hasToken)
                    return (
                      <div key={group.id} className="commander-target-row">
                        <div className="commander-target-info">
                          <span className="commander-sheet-badge">SHEETS</span>
                          <div className="commander-target-details">
                            <span className="commander-target-name">{project.name} → {group.label}</span>
                            <span className="commander-target-path">
                              {group.sheetIds.length} sheet{group.sheetIds.length !== 1 ? 's' : ''} → {group.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-sheet-matrices/
                            </span>
                          </div>
                        </div>
                        <button
                          className={`refresh-btn${!ready ? ' run-btn-disabled' : ''}`}
                          onClick={() => ready && runSheetFetch(group)}
                          disabled={!ready}
                          title={!ready ? 'Add sheets and connect Google account first' : `Refresh ${group.label}`}
                        >
                          Refresh Sheet Data
                        </button>
                      </div>
                    )
                  })}
                                </>
              )}

              {/* DB Targets */}
              {project.dbTargets?.length > 0 && (
                <>
                                    <div className="commander-section-label">DB Targets</div>
                  {project.dbTargets.map((db) => {
                    const isSheets = db.type === 'sheets'
                    const isSQL = db.type === 'sqlite' || db.type === 'postgres'
                    const ready = isSheets
                      ? !!(db.sheetIds?.length > 0 && project.knowledgePath && oauthStatus?.hasToken)
                      : isSQL ? !!(db.connectionInfo && project.knowledgePath) : false
                    const badge = db.type ? db.type.toUpperCase() : 'DB'
                    return (
                      <div key={db.id} className="commander-target-row">
                        <div className="commander-target-info">
                          <span className="commander-sheet-badge">{badge}</span>
                          <div className="commander-target-details">
                            <span className="commander-target-name">{project.name} → {db.label || db.id}</span>
                            <span className="commander-target-path">
                              {isSQL ? (db.lastExported ? `Last exported: ${new Date(db.lastExported).toLocaleString()}` : 'Not yet exported') : `${db.sheetIds?.length || 0} sheet(s)`}
                            </span>
                          </div>
                        </div>
                        <button
                          className={`refresh-btn${!ready ? ' run-btn-disabled' : ''}`}
                          onClick={() => ready && (isSQL ? runSqlExport(db) : runSheetFetch(db))}
                          disabled={!ready}
                          title={!ready ? 'Configure DB target first' : `Generate JSON for ${db.label}`}
                        >
                          Generate JSON
                        </button>
                      </div>
                    )
                                    })}
                </>
              )}
                        </div>

            {activeUser && (
              <CIStatus activeUser={activeUser} project={project} />
            )}
            <div className="terminal-window">
              <div className="terminal-header">
                Terminal Output — repomix engine
                {logs.length > 0 && (
                  <button className="terminal-clear-btn" onClick={() => setLogs([])}>clear</button>
                )}
              </div>
              <div className="terminal-body" ref={terminalRef}>
                {logs.length === 0
                  ? <div className="terminal-empty">No output yet. Execute a build above.</div>
                  : logs.map((log, i) => <div key={i} className="log-line">{log}</div>)
                }
              </div>
            </div>
                    </div>
        )}
                {activeTab === 'patcher' && (
          <CodePatcher project={project} />
        )}
        {activeTab === 'restore' && project && (
          <div className="restore-tab-view">
            <h1>↩ Restore</h1>
            <div className="restore-info-card">
              <span className="restore-info-badge">⚠ Destructive Operation</span>
              <p className="restore-info-text">Select a prior ACT Matrix XML snapshot to roll back, update, or re-apply your project's codebase. ACT will extract the files into a staging directory, check for dependency changes, and let you test the app before anything is permanently changed.</p>
            </div>
            <div className="project-settings-card">
              <div className="restore-field-label">Run Command</div>
              <p className="restore-field-hint">Used to launch and test the restored app from the staging directory before the swap is applied. Set it once and it persists with the project.</p>
              <div className="restore-run-row">
                <input
                  key={project.runCommand}
                  className="commander-run-input"
                  placeholder="e.g. npm run dev"
                  defaultValue={project.runCommand || ''}
                  onBlur={e => updateProject({ runCommand: e.target.value || null })}
                />
              </div>
              {project.runCommand && (
                <code className="restore-run-preview">{project.runCommand}</code>
              )}
            </div>
            <div className="project-settings-card restore-cta-card">
              <div className="restore-field-label">Select a Matrix to Restore From</div>
              <p className="restore-field-hint">Opens a file picker so you can select a prior ACT Matrix XML file from disk. Once selected, ACT will walk you through staging, dependency review, testing, and the final apply step.</p>
              <button className="run-btn restore-browse-btn" onClick={() => setShowRestoreModal(true)}>
                Browse for Matrix XML…
              </button>
            </div>
            {project.matrixHistory?.length > 0 && (
              <div className="project-settings-card">
                <div className="restore-field-label">Build History</div>
                <p className="restore-field-hint">Your last {Math.min(project.matrixHistory.length, 5)} matrix build(s). The XML file for each is in your knowledge folder.</p>
                <table className="restore-history-table">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>File</th>
                      <th>Built</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...project.matrixHistory].reverse().slice(0, 5).map((entry) => (
                      <tr key={entry.version}>
                        <td><span className="restore-history-version">v{entry.version}</span></td>
                        <td className="restore-history-file">{entry.file}</td>
                        <td className="restore-history-ts">{new Date(entry.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
                        {activeTab === 'devkit' && project && (
                    <DevKit project={project} onUpdate={updateProject} />
        )}
        {activeTab === 'database' && project && (
          <DatabaseConfig
            project={project}
            oauthStatus={oauthStatus}
                        onUpdate={updateProject}
            onOAuthRequest={() => setShowOAuthSetup(true)}
          />
        )}
                {activeTab === 'connections' && (
          <Connections activeUser={activeUser} oauthStatus={oauthStatus} onOAuthRequest={() => setShowOAuthSetup(true)} />
        )}
                {activeTab === 'release' && project && (
          <ErrorBoundary name="ReleaseBuilder">
            <ReleaseBuilder project={project} projectFilePath={projectFilePath} activeUser={activeUser} runStatus={releaseRunStatus} setRunStatus={setReleaseRunStatus} dispatching={releaseDispatching} setDispatching={setReleaseDispatching} pollRef={releasePollRef} addLog={addLog} />
          </ErrorBoundary>
        )}
      </section>
    </main>
  )
}
import { useState, useEffect } from 'react'

const DEV_KIT_CATALOG = [
  { category: 'Frontend', items: [
    { id: 'vite',     label: 'Vite',     cmd: 'npm install -D vite', type: 'npm' },
    { id: 'react',    label: 'React',    cmd: 'npm install react react-dom', type: 'npm' },
    { id: 'electron', label: 'Electron', cmd: 'npm install -D electron electron-vite', type: 'npm' },
  ]},
  { category: 'Backend', items: [
    { id: 'venv',    label: 'Python venv', cmd: 'python3 -m venv .venv', type: 'shell' },
    { id: 'flask',   label: 'Flask',       cmd: 'pip3 install flask', type: 'pip' },
    { id: 'fastapi', label: 'FastAPI',     cmd: 'pip3 install fastapi uvicorn', type: 'pip' },
  ]},
  { category: 'Database', items: [
    { id: 'google-auth',    label: 'Google Auth (Sheets)',    cmd: 'pip3 install google-auth-oauthlib google-api-python-client', type: 'pip' },
    { id: 'better-sqlite3', label: 'SQLite (better-sqlite3)', cmd: 'npm install better-sqlite3', type: 'npm' },
    { id: 'pg',             label: 'PostgreSQL (pg)',         cmd: 'npm install pg', type: 'npm' },
    { id: 'sqlalchemy',     label: 'SQLAlchemy',              cmd: 'pip3 install sqlalchemy', type: 'pip' },
    { id: 'psycopg2',       label: 'psycopg2',                cmd: 'pip3 install psycopg2-binary', type: 'pip' },
  ]},
  { category: 'Security', items: [
    { id: 'bcrypt', label: 'bcrypt', cmd: 'npm install bcryptjs', type: 'npm' },
  ]},
]

export default function DevKit({ project, onUpdate }) {
  const [runtimeDeps, setRuntimeDeps] = useState(null)
  const [collapsed, setCollapsed] = useState({})

  const devKit = project.devKit || { selections: [], installed: [], pending: [], activeDependencies: [] }
  const activeDeps = devKit.activeDependencies || []
  const installed = devKit.installed || []

  useEffect(() => {
    window.api.checkRuntimeDeps().then(setRuntimeDeps).catch(() => {})
  }, [])

  const updateDevKit = (updater) =>
    onUpdate(prev => ({ ...prev, devKit: { ...(prev.devKit || {}), ...updater(prev.devKit || {}) } }))

  const handleInstall = (item) => {
    updateDevKit(dk => ({ ...dk, pending: [...(dk.pending || []), item.id] }))
    window.api.runScript({ command: item.cmd, cwd: project.rootPath })
  }

  const handleUninstall = (item) => {
    const cmd = item.type === 'npm'
      ? `npm uninstall ${item.id} --prefix "${project.rootPath}"`
      : `pip3 uninstall -y ${item.id}`
    window.api.runScript({ command: cmd, cwd: project.rootPath })
    updateDevKit(dk => ({ ...dk, installed: (dk.installed || []).filter(x => x !== item.id) }))
  }

  const toggleCollapse = (cat) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))

  return (
    <div className="devkit-view">
      <h1>Dev Kit</h1>

      <div className="devkit-runtime-bar">
        {runtimeDeps ? (
          ['node', 'python3', 'pip3'].map(tool => (
            <div key={tool} className={`devkit-runtime-chip${runtimeDeps[tool]?.available ? ' ok' : ' warn'}`}>
              {runtimeDeps[tool]?.available ? '✓' : '⚠'} {tool}
              {runtimeDeps[tool]?.version ? ` ${runtimeDeps[tool].version}` : ' — not found'}
            </div>
          ))
        ) : (
          <div className="devkit-runtime-chip">Checking environment...</div>
        )}
      </div>

      <div className="devkit-warn-note">
        ⚠ Uninstalling a package your code depends on may break your app. Active dependencies detected from your latest matrix build are locked.
      </div>

      <div className="devkit-catalog">
        {DEV_KIT_CATALOG.map(cat => {
          const isCollapsed = collapsed[cat.category]
          const installedCount = cat.items.filter(it => installed.includes(it.id)).length
          return (
            <div key={cat.category} className="devkit-category">
              <button className="devkit-cat-header" onClick={() => toggleCollapse(cat.category)}>
                <span className="devkit-cat-arrow">{isCollapsed ? '▶' : '▼'}</span>
                <span className="devkit-cat-label">{cat.category}</span>
                <span className="devkit-cat-count">{installedCount} installed</span>
              </button>
              {!isCollapsed && (
                <div className="devkit-cat-items">
                  {cat.items.map(item => {
                    const isActive = activeDeps.includes(item.id)
                    const isInstalled = installed.includes(item.id)
                    const isPending = devKit.pending?.includes(item.id)
                    return (
                      <div key={item.id} className={`devkit-item${isActive ? ' is-locked' : ''}`}>
                        <div className="devkit-item-info">
                          <span className="devkit-item-label">{item.label}</span>
                          <code className="devkit-item-type">{item.type}</code>
                          {isActive && <span className="devkit-lock-badge">🔒 active dep</span>}
                          {isPending && !isInstalled && <span className="devkit-pending-badge">installing…</span>}
                        </div>
                        <div className="devkit-item-actions">
                          {isInstalled ? (
                            <button className="devkit-uninstall-btn" disabled={isActive}
                              title={isActive ? 'Remove the import from your code first' : `Uninstall ${item.label}`}
                              onClick={() => !isActive && handleUninstall(item)}>
                              Remove
                            </button>
                          ) : (
                            <button className="devkit-install-btn" disabled={isPending}
                              onClick={() => handleInstall(item)}>
                              Install
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
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
    { id: 'google-auth-oauthlib', label: 'Google Auth (Sheets)',    cmd: 'pip3 install google-auth-oauthlib google-api-python-client', type: 'pip' },
    { id: 'better-sqlite3', label: 'SQLite (better-sqlite3)', cmd: 'npm install better-sqlite3', type: 'npm' },
    { id: 'pg',             label: 'PostgreSQL (pg)',         cmd: 'npm install pg', type: 'npm' },
    { id: 'sqlalchemy',     label: 'SQLAlchemy',              cmd: 'pip3 install sqlalchemy', type: 'pip' },
    { id: 'psycopg2-binary', label: 'psycopg2',               cmd: 'pip3 install psycopg2-binary', type: 'pip' },
  ]},
    { category: 'Security', items: [
    { id: 'bcryptjs', label: 'bcryptjs', cmd: 'npm install bcryptjs', type: 'npm' },
  ]},
  { category: 'Node.js', items: [
    { id: 'nvm',     label: 'nvm',     cmd: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash', type: 'shell' },
    { id: 'nodemon', label: 'nodemon', cmd: 'npm install -g nodemon', type: 'npm' },
  ]},
]

export default function DevKit({ project, onUpdate }) {
    const [runtimeDeps, setRuntimeDeps] = useState(null)
        const [collapsed, setCollapsed] = useState({})
  const [verifying, setVerifying] = useState(false)
  const [uninstallConfirm, setUninstallConfirm] = useState(null)
  const [showEditStack, setShowEditStack] = useState(false)
  const [editStackChecked, setEditStackChecked] = useState({})

  const devKit = project.devKit || { selections: [], installed: [], pending: [], activeDependencies: [] }
  const activeDeps = devKit.activeDependencies || []
  const installed = devKit.installed || []

    useEffect(() => {
        window.api.checkRuntimeDeps().then(setRuntimeDeps).catch(() => {})

    const currentInstalled = project.devKit?.installed || []
    const allCatalogPkgs = DEV_KIT_CATALOG.flatMap(cat =>
      cat.items.filter(it => it.type !== 'shell').map(it => ({ id: it.id, type: it.type }))
    )

        setVerifying(true)
    window.api.verifyDevkitInstalled({ rootPath: project.rootPath, packages: allCatalogPkgs })
      .then(({ verified }) => {
        if (verified.length > 0) {
          const merged = [...new Set([...currentInstalled, ...verified])]
          const differs = merged.length !== currentInstalled.length
          if (differs) {
            onUpdate(prev => ({
              ...prev,
              devKit: { ...(prev.devKit || {}), installed: merged }
            }))
          }
        }
      })
      .catch(() => {})
      .finally(() => setVerifying(false))
  }, [])

  const updateDevKit = (updater) =>
    onUpdate(prev => ({ ...prev, devKit: { ...(prev.devKit || {}), ...updater(prev.devKit || {}) } }))

    const handleInstall = (item) => {
    updateDevKit(dk => ({ ...dk, pending: [...(dk.pending || []), item.id] }))
    window.api.runScript({ command: item.cmd, cwd: project.rootPath })
  }

  const handleUninstall = (item) => setUninstallConfirm(item)

  const handleConfirmUninstall = () => {
    if (!uninstallConfirm) return
    const item = uninstallConfirm
    const cmd = item.type === 'npm'
      ? `npm uninstall ${item.id} --prefix "${project.rootPath}"`
      : `pip3 uninstall -y ${item.id}`
    window.api.runScript({ command: cmd, cwd: project.rootPath })
    updateDevKit(dk => ({ ...dk, installed: (dk.installed || []).filter(x => x !== item.id) }))
        setUninstallConfirm(null)
  }

  const toggleCollapse = (cat) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))

  const handleEditStackConfirm = async () => {
    const toRemove = installed.filter(id => editStackChecked[id])
    if (!toRemove.length) { setShowEditStack(false); return }
    const allItems = DEV_KIT_CATALOG.flatMap(c => c.items)
    for (const id of toRemove) {
      const item = allItems.find(it => it.id === id) || { id, type: 'npm' }
      const cmd = item.type === 'npm'
        ? `npm uninstall ${id} --prefix "${project.rootPath}"`
        : `pip3 uninstall -y ${id}`
      window.api.runScript({ command: cmd, cwd: project.rootPath })
    }
    const affectedImports = (devKit.activeDependencies || [])
      .filter(id => toRemove.includes(id))
      .map(id => ({ file: 'See matrix scan', module: id }))
    await window.api.writeMigrationDoc({
      projectName: project.name,
      knowledgePath: project.knowledgePath,
      removed: toRemove.map(id => { const it = allItems.find(i => i.id === id) || { id, cmd: id }; return { id, cmd: it.cmd } }),
      added: [],
      affectedImports
    })
    updateDevKit(dk => ({ ...dk, installed: (dk.installed || []).filter(id => !toRemove.includes(id)) }))
    setShowEditStack(false)
    setEditStackChecked({})
  }

    return (
    <div className="devkit-view">
      <h1>Dev Kit {verifying && <span className="devkit-verifying-badge">verifying…</span>}</h1>

            <div className="devkit-runtime-bar">
        {runtimeDeps ? (
          ['node', 'python3', 'pip3', 'postgres'].map(tool => (
            <div key={tool} className={`devkit-runtime-chip${runtimeDeps[tool]?.available ? ' ok' : ' warn'}`}>
              {runtimeDeps[tool]?.available ? '✓' : '⚠'} {tool}
              {runtimeDeps[tool]?.version ? ` ${runtimeDeps[tool].version}` : ' — not found'}
            </div>
          ))
        ) : (
          <div className="devkit-runtime-chip">Checking environment...</div>
                )}
      </div>

      {installed.length > 0 && (
        <div className="devkit-section">
                    <div className="devkit-section-header">
            <span className="devkit-section-label">Installed Stack</span>
            <span className="devkit-section-count">{installed.length} package{installed.length !== 1 ? 's' : ''}</span>
            <button className="devkit-edit-stack-btn" onClick={() => { setShowEditStack(true); setEditStackChecked({}) }}>Edit Stack</button>
          </div>
          <table className="devkit-stack-table">
            <tbody>
              {installed.map(id => {
                const allItems = DEV_KIT_CATALOG.flatMap(c => c.items)
                const item = allItems.find(it => it.id === id) || { id, label: id, type: 'npm' }
                const isActive = activeDeps.includes(id)
                return (
                  <tr key={id} className={`devkit-stack-row${isActive ? ' is-locked' : ''}`}>
                    <td className="devkit-stack-label">{item.label}</td>
                    <td><code className="devkit-item-type">{item.type}</code></td>
                    <td className="devkit-stack-actions">
                      {isActive
                        ? <span className="devkit-lock-badge" title="Remove the import from your code first">🔒 active dep</span>
                        : <button className="devkit-uninstall-btn" onClick={() => handleUninstall(item)}>Remove</button>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="devkit-section">
        <div className="devkit-section-header">
          <span className="devkit-section-label">Add to Stack</span>
        </div>
        <div className="devkit-catalog">
          {DEV_KIT_CATALOG.map(cat => {
            const availableItems = cat.items.filter(it => !installed.includes(it.id))
            if (availableItems.length === 0) return null
            const isCollapsed = collapsed[cat.category]
            return (
              <div key={cat.category} className="devkit-category">
                <button className="devkit-cat-header" onClick={() => toggleCollapse(cat.category)}>
                  <span className="devkit-cat-arrow">{isCollapsed ? '▶' : '▼'}</span>
                  <span className="devkit-cat-label">{cat.category}</span>
                  <span className="devkit-cat-count">{availableItems.length} available</span>
                </button>
                {!isCollapsed && (
                  <div className="devkit-cat-items">
                    {availableItems.map(item => {
                      const isPending = devKit.pending?.includes(item.id)
                      return (
                        <div key={item.id} className="devkit-item">
                          <div className="devkit-item-info">
                            <span className="devkit-item-label">{item.label}</span>
                            <code className="devkit-item-type">{item.type}</code>
                            {isPending && <span className="devkit-pending-badge">installing…</span>}
                          </div>
                          <div className="devkit-item-actions">
                            <button className="devkit-install-btn" disabled={isPending}
                              onClick={() => handleInstall(item)}>
                              Install
                            </button>
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

      {uninstallConfirm && (
        <div className="modal-overlay" onClick={() => setUninstallConfirm(null)}>
          <div className="devkit-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="devkit-confirm-title">Remove package?</div>
            <div className="devkit-confirm-body">
              Removing <strong>{uninstallConfirm.label}</strong> may break your app if it is actively imported.
            </div>
            <div className="devkit-confirm-actions">
                            <button className="modal-cancel-btn" onClick={() => setUninstallConfirm(null)}>Cancel</button>
              <button className="devkit-uninstall-btn" onClick={handleConfirmUninstall}>Remove</button>
            </div>
          </div>
        </div>
      )}
      {showEditStack && (
        <div className="modal-overlay" onClick={() => setShowEditStack(false)}>
          <div className="devkit-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="devkit-confirm-title">Edit Stack</div>
            <div className="devkit-confirm-body">
              {installed.map(id => {
                const allItems = DEV_KIT_CATALOG.flatMap(c => c.items)
                const item = allItems.find(it => it.id === id) || { id, label: id }
                const isActive = activeDeps.includes(id)
                return (
                  <div key={id} className="devkit-edit-row">
                    <input
                      type="checkbox"
                      disabled={isActive}
                      checked={!!editStackChecked[id]}
                      onChange={e => setEditStackChecked(prev => ({ ...prev, [id]: e.target.checked }))}
                    />
                    <span className={isActive ? 'devkit-lock-label' : ''}>{item.label}</span>
                    {isActive && <span className="devkit-lock-badge" title="Active dep — remove import first">🔒</span>}
                  </div>
                )
              })}
            </div>
            <div className="devkit-confirm-actions">
              <button className="modal-cancel-btn" onClick={() => setShowEditStack(false)}>Cancel</button>
              <button className="devkit-uninstall-btn" onClick={handleEditStackConfirm}>Remove Selected</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
import { useState, useEffect } from 'react'

export default function ProjectPicker({ onProjectLoaded, activeUser, onBuildNewDirectory }) {
  const [recentProjects, setRecentProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [collabToken, setCollabToken] = useState('')
  const [collabError, setCollabError] = useState(null)
  const [collabLoading, setCollabLoading] = useState(false)

  useEffect(() => {
    if (!window.api) return
    window.api.getRecentProjects().then(projects => {
      const filtered = projects.filter(p =>
        !p.userId || p.userId === activeUser?.id
      )
      setRecentProjects(filtered)
      setLoading(false)
    })
  }, [activeUser])

  const handleOpenExistingFolder = async () => {
    const rootPath = await window.api.selectFolder()
    if (!rootPath) return
    const folderName = rootPath.split('/').pop()
    const fileTree = await window.api.scanDirectory(rootPath)
    const project = {
      type: 'ACT_PROJECT',
      name: folderName,
      rootPath,
      knowledgePath: '',
      knowledgeAbsolute: true,
      ownerId: activeUser?.id || null,
      allowedUsers: [],
      collaborationTokens: [],
      targets: [{
        id: 'root',
        isRoot: true,
        class: null,
        folderPath: rootPath,
        outputPath: null,
        fileTree,
        ignorePatterns: [],
        repomixIgnoreFile: null,
        repomixIgnorePatterns: []
      }]
    }
    onProjectLoaded(project, null)
  }

  const handleOpenProject = async () => {
    const result = await window.api.openProjectFile()
    if (!result) return
    await window.api.addRecentProject({
      filePath: result.filePath,
      projectName: result.data.name,
      userId: activeUser?.id
    })
    onProjectLoaded(result.data, result.filePath)
  }

  const handleRecentProject = async (recent) => {
    const result = await window.api.loadProject(recent.filePath)
    if (!result) {
      const updated = await window.api.getRecentProjects()
      setRecentProjects(updated.filter(p => !p.userId || p.userId === activeUser?.id))
      return
    }
    onProjectLoaded(result.data, result.filePath)
  }

  const handleRedeemToken = async () => {
    const token = collabToken.trim()
    if (!token) return
    setCollabLoading(true)
    setCollabError(null)
    const result = await window.api.redeemCollabToken({
      token,
      userId: activeUser?.id
    })
    setCollabLoading(false)
    if (!result.success) { setCollabError(result.error); return }
    await window.api.addRecentProject({
      filePath: result.filePath,
      projectName: result.projectName,
      userId: activeUser?.id
    })
    const loaded = await window.api.loadProject(result.filePath)
    if (loaded) onProjectLoaded(loaded.data, loaded.filePath)
  }

  return (
    <div className="picker-screen">
      <div className="picker-panel">
        <div className="picker-brand">
          <div className="picker-logo">⬡</div>
          <h1 className="picker-title">ACT Build Controller</h1>
          <p className="picker-subtitle">Matrix Orchestration System</p>
        </div>

        {activeUser && (
          <div className="picker-user-badge">
            Signed in as <strong>{activeUser.displayName}</strong>
          </div>
        )}

        <div className="picker-actions">
          <button className="picker-btn picker-btn-primary" onClick={onBuildNewDirectory}>
            <span className="picker-btn-icon">+</span>
            Build New Project Directory
          </button>
          <button className="picker-btn picker-btn-secondary" onClick={handleOpenExistingFolder}>
            <span className="picker-btn-icon">📂</span>
            Open Existing Project Folder
          </button>
          <button className="picker-btn picker-btn-secondary" onClick={handleOpenProject}>
            <span className="picker-btn-icon">📄</span>
            Open Project
          </button>
        </div>

        {!loading && recentProjects.length > 0 && (
          <div className="picker-recent">
            <div className="picker-recent-label">Recent Projects</div>
            <div className="picker-recent-list">
              {recentProjects.map((p, i) => (
                <button key={i} className="picker-recent-item" onClick={() => handleRecentProject(p)}>
                  <span className="picker-recent-name">{p.projectName}</span>
                  <span className="picker-recent-path">{p.filePath}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="picker-collab">
          <div className="picker-recent-label">Join a Project</div>
          <div className="picker-collab-row">
            <input
              className="login-input"
              placeholder="Enter collaboration token..."
              value={collabToken}
              onChange={e => { setCollabToken(e.target.value); setCollabError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') handleRedeemToken() }}
            />
            <button
              className="picker-btn picker-btn-secondary"
              onClick={handleRedeemToken}
              disabled={!collabToken.trim() || collabLoading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {collabLoading ? '...' : 'Join →'}
            </button>
          </div>
          {collabError && <div className="login-error" style={{ marginTop: 6 }}>{collabError}</div>}
        </div>
      </div>
    </div>
  )
}
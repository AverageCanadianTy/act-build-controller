import { useState, useEffect } from 'react'

export default function ProjectPicker({ onProjectLoaded }) {
  const [recentProjects, setRecentProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.api) return
    window.api.getRecentProjects().then(projects => {
      setRecentProjects(projects)
      setLoading(false)
    })
  }, [])

  const handleNewProject = async () => {
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
    await window.api.addRecentProject({ filePath: result.filePath, projectName: result.data.name })
    onProjectLoaded(result.data, result.filePath)
  }

  const handleRecentProject = async (recent) => {
    const result = await window.api.loadProject(recent.filePath)
    if (!result) {
      const updated = await window.api.getRecentProjects()
      setRecentProjects(updated)
      return
    }
    onProjectLoaded(result.data, result.filePath)
  }

  return (
    <div className="picker-screen">
      <div className="picker-panel">
        <div className="picker-brand">
          <div className="picker-logo">⬡</div>
          <h1 className="picker-title">ACT Build Controller</h1>
          <p className="picker-subtitle">Matrix Orchestration System</p>
        </div>

        <div className="picker-actions">
          <button className="picker-btn picker-btn-primary" onClick={handleNewProject}>
            <span className="picker-btn-icon">+</span>
            New Project
          </button>
          <button className="picker-btn picker-btn-secondary" onClick={handleOpenProject}>
            <span className="picker-btn-icon">📂</span>
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
      </div>
    </div>
  )
}
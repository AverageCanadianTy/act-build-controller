import { useState, useEffect } from 'react'

export default function CIStatus({ activeUser, project }) {
  const [runData, setRunData] = useState(null)
  const [repoInfo, setRepoInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const projectPath = project?.targets?.find(t => t.isRoot)?.folderPath || null

  useEffect(() => {
    if (!projectPath) return
    window.api.getGitRemote(projectPath).then(remote => {
      if (remote?.owner && remote?.repo) {
        setRepoInfo({ owner: remote.owner, repo: remote.repo })
      }
    })
  }, [projectPath])

  const handleRefresh = async () => {
    if (!repoInfo || !activeUser?.id) return
    setLoading(true)
    setError(null)
    try {
      const { pat } = await window.api.getGithubPat(activeUser.id)
      if (!pat) { setError('GitHub not connected — go to Connections tab'); setLoading(false); return }
      const run = await window.api.pollGithubRun({ pat, owner: repoInfo.owner, repo: repoInfo.repo })
      setRunData(run)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  if (!repoInfo) return null

  const conclusionClass = runData?.conclusion === 'success' ? 'success'
    : runData?.conclusion === 'failure' ? 'failure'
    : runData?.status === 'in_progress' ? 'in_progress'
    : 'queued'

  const conclusionLabel = runData?.conclusion === 'success' ? '✓ Success'
    : runData?.conclusion === 'failure' ? '✗ Failed'
    : runData?.status === 'in_progress' ? '⟳ Building…'
    : runData?.status === 'none' || !runData ? '— No runs yet'
    : '· Queued'

  return (
    <div className="ci-status-bar">
      <span className="ci-status-label">GitHub CI</span>
      {runData && runData.status !== 'none' ? (
        <span className={`release-run-badge ${conclusionClass}`}>{conclusionLabel}</span>
      ) : (
        <span className="ci-status-none">{conclusionLabel}</span>
      )}
      {runData?.url && (
        <span className="release-run-link" onClick={() => window.api.openExternal(runData.url)}>View run ↗</span>
      )}
      <button className="ci-refresh-btn" onClick={handleRefresh} disabled={loading}>
        {loading ? '…' : '↻ Refresh'}
      </button>
      {error && <span className="ci-status-error">{error}</span>}
    </div>
  )
}
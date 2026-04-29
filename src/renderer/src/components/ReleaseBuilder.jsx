import { useState, useEffect, useRef } from 'react'

const TARGETS = [
  { id: 'appimage', label: 'Linux AppImage', badge: 'linux', localOk: true, ciOk: true },
  { id: 'deb-x64', label: 'Linux .deb (x64)', badge: 'linux', localOk: true, ciOk: true },
  { id: 'deb-arm64', label: 'Linux .deb (arm64)', badge: 'linux', localOk: true, ciOk: true },
  { id: 'win-nsis', label: 'Windows NSIS Installer', badge: 'win', localOk: true, ciOk: true },
  { id: 'mac-dmg', label: 'macOS DMG', badge: 'mac', localOk: false, ciOk: true, requiresMac: true },
  { id: 'gh-release', label: 'GitHub Release', badge: 'gh', localOk: false, ciOk: true, requiresGitHub: true },
]

function semverBump(version, type) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function parseRepoFromPackage(pkg) {
  const url = pkg?.homepage || pkg?.repository?.url || pkg?.repository || ''
    const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/)
  return m ? { owner: m[1], repo: m[2] } : null
}

export default function ReleaseBuilder({ project, projectFilePath, activeUser, runStatus, setRunStatus, dispatching, setDispatching, pollRef, addLog }) {
  const [version, setVersion] = useState(null)
  const [selected, setSelected] = useState(new Set(['appimage', 'deb-x64', 'win-nsis']))
  const [githubConnected, setGithubConnected] = useState(false)
    const [repoInfo, setRepoInfo] = useState(null)
  const [advisor, setAdvisor] = useState([])
  const [releaseTitle, setReleaseTitle] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [committingWorkflow, setCommittingWorkflow] = useState(false)


  const projectPath = project?.targets?.find(t => t.isRoot)?.folderPath || null


    useEffect(() => {
    if (!projectPath) return
    window.api.getPackageVersion(projectPath).then(r => { if (r.version) setVersion(r.version) })
    if (activeUser?.id) {
      window.api.getGithubPat(activeUser.id).then(({ pat }) => {
        if (pat) {
          setGithubConnected(true)
          window.api.testGithubConnection({ pat }).then(res => {
            if (!res.success) setGithubConnected(false)
          })
        }
      })
    }
    // Repo detection: git remote first, package.json fallback
    window.api.getGitRemote(projectPath).then(remote => {
      if (remote?.owner && remote?.repo) {
        setRepoInfo({ owner: remote.owner, repo: remote.repo })
      } else {
        window.api.readFileForPatch(projectPath + '/package.json').then(r => {
          if (r.success) {
            try { setRepoInfo(parseRepoFromPackage(JSON.parse(r.content))) } catch {}
          }
        })
      }
    })
  }, [projectPath, activeUser?.id])


  useEffect(() => {
    const items = []
    if (selected.has('mac-dmg') || selected.has('gh-release')) {
      if (!githubConnected) items.push({ icon: '⚠', key: 'gh-pat', text: 'GitHub PAT not configured.', action: 'Go to Connections tab to connect GitHub.', nav: 'connections' })
      if (selected.has('mac-dmg')) items.push({ icon: 'ℹ', key: 'mac-ci', text: 'macOS DMG requires a macOS runner.', action: 'Will be built via GitHub CI on macos-latest.' })
    }
    if (selected.has('mac-dmg')) {
      items.push({ icon: 'ℹ', key: 'mac-builder', text: 'electron-builder.yml mac: section will be added automatically if missing.' })
    }
    if (!repoInfo && (selected.has('gh-release') || selected.has('mac-dmg'))) {
      items.push({ icon: '⚠', key: 'no-repo', text: 'Could not detect GitHub repo from package.json homepage.', action: 'Ensure homepage is set to your GitHub repo URL.' })
    }
        setAdvisor(items)
  }, [selected, githubConnected, repoInfo])

  const toggleTarget = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleBump = async (type) => {
    if (!version || !projectPath) return
    const next = semverBump(version, type)
    const res = await window.api.bumpPackageVersion({ projectPath, version: next })
    if (res.success) setVersion(next)
  }

    const handleLocalBuild = async () => {
    if (!projectPath) return
    const targets = [...selected].filter(id => TARGETS.find(t => t.id === id)?.localOk)
    window.api.runScript({ command: `cd "${projectPath}" && npm run build && npx electron-builder`, cwd: projectPath })
  }

  const handleCIDispatch = async () => {
    if (!version || !repoInfo || !githubConnected) return
    setDispatching(true)
    setRunStatus({ status: 'queued' })
    addLog('[RELEASE] Starting CI dispatch...')
    const { pat } = await window.api.getGithubPat(activeUser.id)
    if (selected.has('mac-dmg')) await window.api.patchElectronBuilderMac({ projectPath })
    await window.api.generateGithubWorkflow({ projectPath })
    addLog('[RELEASE] Pushing workflow to GitHub...')
    const workflowPush = await window.api.commitPushWorkflow({ projectPath, pat, owner: repoInfo.owner, repo: repoInfo.repo })
    if (!workflowPush.success) {
      setDispatching(false)
      setRunStatus({ status: 'failure', error: 'Workflow push failed: ' + workflowPush.error })
      addLog('[RELEASE] FAIL: ' + workflowPush.error)
      return
    }
    addLog('[RELEASE] OK: Workflow ready on remote.')
    addLog('[RELEASE] Dispatching v' + version + '...')
    const dispatch = await window.api.dispatchGithubWorkflow({ pat, owner: repoInfo.owner, repo: repoInfo.repo, version, releaseTitle, releaseNotes })
    setDispatching(false)
    if (!dispatch.success) {
      setRunStatus({ status: 'failure', error: dispatch.error })
      addLog('[RELEASE] FAIL: ' + dispatch.error)
      return
    }
    addLog('[RELEASE] OK: Runners starting...')
    setRunStatus({ status: 'in_progress' })
    pollRef.current = setInterval(async () => {
      const run = await window.api.pollGithubRun({ pat, owner: repoInfo.owner, repo: repoInfo.repo })
      if (run.status === 'completed') {
        clearInterval(pollRef.current)
        const verdict = run.conclusion === 'success' ? 'OK: Build succeeded' : 'FAIL: Build failed'
        addLog('[RELEASE] ' + verdict + ' - ' + run.url)
        setRunStatus({ status: run.conclusion, url: run.url })
      } else if (run.status !== 'none') {
        setRunStatus({ status: run.status, url: run.url })
      }
    }, 10000)
  }

  const ciBlocked = !githubConnected || !repoInfo || advisor.some(a => a.key === 'no-repo' || a.key === 'gh-pat')
  const localTargets = [...selected].filter(id => TARGETS.find(t => t.id === id)?.localOk)

  return (
    <div className="release-view">
      <h1>Release Builder</h1>

      {/* Version */}
      <div className="release-card">
        <div className="release-card-title">Version</div>
        <div className="release-version-row">
          <span className="release-version-current">v{version || '…'}</span>
          <button className="release-bump-btn" onClick={() => handleBump('patch')} disabled={!version}>patch → {version ? semverBump(version, 'patch') : '…'}</button>
          <button className="release-bump-btn" onClick={() => handleBump('minor')} disabled={!version}>minor → {version ? semverBump(version, 'minor') : '…'}</button>
          <button className="release-bump-btn" onClick={() => handleBump('major')} disabled={!version}>major → {version ? semverBump(version, 'major') : '…'}</button>
        </div>
      </div>

      {/* Target Grid */}
      <div className="release-card">
        <div className="release-card-title">Build Targets</div>
        <div className="release-target-grid">
          {TARGETS.map(t => {
            const isSelected = selected.has(t.id)
            const statusLabel = !t.localOk && !githubConnected ? 'Requires GitHub CI — not connected' : !t.localOk ? 'CI only' : 'Ready'
            const statusClass = !t.localOk && !githubConnected ? 'warn' : !t.localOk ? 'ci-only' : 'ready'
            return (
              <div
                key={t.id}
                className={`release-target-card ${isSelected ? 'selected' : ''}`}
                onClick={() => toggleTarget(t.id)}
              >
                <span className={`release-target-badge ${t.badge}`}>{t.badge.toUpperCase()}</span>
                <span className="release-target-name">{t.label}</span>
                <span className={`release-target-status ${statusClass}`}>{statusLabel}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Resource Advisor */}
      {advisor.length > 0 && (
        <div className="release-card">
          <div className="release-card-title">Resource Advisor</div>
          <div className="release-advisor">
            {advisor.map(item => (
              <div key={item.key} className="release-advisor-item">
                <span className="release-advisor-icon">{item.icon}</span>
                <div className="release-advisor-text">
                  <strong>{item.text}</strong>
                  {item.action && <div>{item.action}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

            {/* Release Notes */}
      <div className="release-card">
        <div className="release-card-title">Release Notes</div>
        <input
          className="connections-pat-input"
          style={{ marginBottom: 8 }}
          type="text"
          placeholder={`v${version || '…'} — What's in this release? (becomes GitHub release title)`}
          value={releaseTitle}
          onChange={e => setReleaseTitle(e.target.value)}
        />
        <textarea
          className="release-notes-textarea"
          placeholder={`What's new in v${version || '…'}? Describe features, fixes, and breaking changes.`}
          value={releaseNotes}
          onChange={e => setReleaseNotes(e.target.value)}
        />
      </div>

      {/* Execute */}
      <div className="release-card">
        <div className="release-card-title">Execute</div>
        {runStatus && (
          <div className="release-run-status">
            <span className={`release-run-badge ${runStatus.status}`}>
              {runStatus.status === 'in_progress' ? '⟳ Building…' : runStatus.status === 'success' ? '✓ Success' : runStatus.status === 'failure' ? '✗ Failed' : '· Queued'}
            </span>
            {runStatus.url && <span className="release-run-link" onClick={() => window.api.openExternal(runStatus.url)}>View on GitHub ↗</span>}
          </div>
        )}
        <div className="release-execute-row">
          <button className="release-exec-btn local" onClick={handleLocalBuild} disabled={localTargets.length === 0}>
            ⚡ Build Local ({localTargets.length} target{localTargets.length !== 1 ? 's' : ''})
          </button>
          <button className="release-exec-btn ci" onClick={handleCIDispatch} disabled={ciBlocked || dispatching || selected.size === 0}>
            {dispatching ? '⟳ Dispatching…' : '⬆ Dispatch to GitHub CI'}
          </button>
        </div>
      </div>
    </div>
  )
}
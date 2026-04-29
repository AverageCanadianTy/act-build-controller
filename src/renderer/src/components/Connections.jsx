import { useState, useEffect } from 'react'

export default function Connections({ activeUser, oauthStatus, onOAuthRequest }) {
    const [pat, setPat] = useState('')
  const [githubStatus, setGithubStatus] = useState(null) // null | { login, avatarUrl } | { error }
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [homepagePrompt, setHomepagePrompt] = useState(null)

  useEffect(() => {
    if (!activeUser?.id) return
    window.api.getGithubPat(activeUser.id).then(({ pat: stored }) => {
      if (stored) {
        setTesting(true)
        window.api.testGithubConnection({ pat: stored }).then(res => {
          setTesting(false)
          if (res.success) setGithubStatus({ login: res.login, avatarUrl: res.avatarUrl })
          else setGithubStatus({ error: 'Stored PAT invalid — reconnect' })
        })
      }
    })
  }, [activeUser?.id])

  const handleConnect = async () => {
    if (!pat.trim()) return
    setTesting(true)
    const res = await window.api.testGithubConnection({ pat: pat.trim() })
    setTesting(false)
    if (!res.success) { setGithubStatus({ error: res.error }); return }
    setSaving(true)
        await window.api.saveGithubPat({ userId: activeUser.id, pat: pat.trim() })
    setSaving(false)
    setGithubStatus({ login: res.login, avatarUrl: res.avatarUrl })
    setPat('')
    // Prompt homepage fix if needed
    if (activeUser?.projectPath) {
      window.api.readFileForPatch(activeUser.projectPath + '/package.json').then(r => {
        if (r.success) {
          try {
            const pkg = JSON.parse(r.content)
            if (!pkg.homepage || !pkg.homepage.includes('github.com')) {
              setHomepagePrompt({ login: res.login, current: pkg.homepage })
            }
          } catch {}
        }
      })
    }
  }

    const handleDisconnect = async () => {
    await window.api.saveGithubPat({ userId: activeUser.id, pat: '' })
    setGithubStatus(null)
    setPat('')
  }

  const googleConnected = oauthStatus?.hasToken

  return (
    <div className="connections-view">
      <h1>Connections</h1>

      <div className="connections-section">
        <div className="connections-section-title">Google</div>
                <div className="connections-service-row">
          <span className="connections-service-icon">🔵</span>
          <div className="connections-service-info">
            <span className="connections-service-name">Google OAuth</span>
            <span className={`connections-service-status ${googleConnected ? 'connected' : ''}`}>
              {googleConnected ? 'Connected — authorized' : 'Not connected'}
            </span>
          </div>
          {googleConnected
            ? <button className="release-exec-btn local" style={{ flex: 'none', padding: '6px 14px', fontSize: '0.76rem' }} onClick={() => window.api.disconnectGoogle({ userId: activeUser?.id })}>Disconnect</button>
            : <button className="connections-connect-btn" onClick={onOAuthRequest}>Connect</button>
          }
        </div>
        <div className="connections-scopes-note">Required for Database Config Google Sheets integration.</div>
      </div>

      <div className="connections-section">
        <div className="connections-section-title">GitHub</div>
        <div className="connections-service-row">
          <span className="connections-service-icon">⬡</span>
          <div className="connections-service-info">
            <span className="connections-service-name">GitHub Personal Access Token</span>
            <span className={`connections-service-status ${githubStatus?.login ? 'connected' : githubStatus?.error ? 'error' : ''}`}>
              {testing ? 'Verifying…'
                : saving ? 'Saving…'
                : githubStatus?.login ? `Connected as @${githubStatus.login}`
                : githubStatus?.error ? githubStatus.error
                : 'Not connected'}
            </span>
          </div>
          {githubStatus?.login && (
            <button className="release-exec-btn local" style={{ flex: 'none', padding: '6px 14px', fontSize: '0.76rem' }} onClick={handleDisconnect}>Disconnect</button>
          )}
        </div>
        {!githubStatus?.login && (
          <>
            <div className="connections-pat-row">
              <input
                className="connections-pat-input"
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={pat}
                onChange={e => setPat(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleConnect() }}
              />
              <button
                className="connections-connect-btn"
                onClick={handleConnect}
                disabled={!pat.trim() || testing || saving}
                            >
                {testing ? 'Verifying…' : saving ? 'Saving…' : 'Connect'}
              </button>
            </div>
            <div className="release-guide-box" style={{ marginTop: 4 }}>
              <div className="release-guide-step"><strong>Step 1:</strong> <span className="release-advisor-action" onClick={() => window.api.openExternal('https://github.com/join')}>Create a GitHub account ↗</span> if you don't have one.</div>
              <div className="release-guide-step"><strong>Step 2:</strong> Go to <span className="release-advisor-action" onClick={() => window.api.openExternal('https://github.com/settings/tokens/new?scopes=repo,workflow&description=ACT+Build+Controller')}>Settings → Developer settings → Personal access tokens ↗</span> and generate a new token (classic).</div>
              <div className="release-guide-step"><strong>Step 3:</strong> Enable scopes: <strong>repo</strong> and <strong>workflow</strong>. Set expiration as desired.</div>
              <div className="release-guide-step"><strong>Step 4:</strong> Copy the token and paste it above. ACT stores it securely using your OS keychain.</div>
            </div>
            <div className="connections-scopes-note">
              Required scopes: <strong>repo</strong>, <strong>workflow</strong>.{' '}
              <span className="release-advisor-action" onClick={() => window.api.openExternal('https://github.com/settings/tokens/new?scopes=repo,workflow&description=ACT+Build+Controller')}>
                Generate token ↗
              </span>
            </div>
          </>
        )}
        {homepagePrompt && (
          <div className="release-advisor-item" style={{ marginTop: 8 }}>
            <span className="release-advisor-icon">💡</span>
            <div className="release-advisor-text">
              <strong>package.json homepage not pointing to GitHub.</strong>
              <div>Current: <code>{homepagePrompt.current || 'not set'}</code></div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <span className="release-advisor-action" onClick={async () => {
                  if (activeUser?.projectPath) {
                    await window.api.updatePackageHomepage({ projectPath: activeUser.projectPath, homepage: `https://github.com/${homepagePrompt.login}/` })
                    setHomepagePrompt(null)
                  }
                }}>Set to github.com/{homepagePrompt.login}/ ✓</span>
                <span className="release-advisor-action" style={{ color: '#4a5568' }} onClick={() => setHomepagePrompt(null)}>Dismiss</span>
              </div>
            </div>
          </div>
        )}
        <div className="connections-scopes-note">Required for Release Builder CI dispatch and GitHub Release creation.</div>
      </div>
    </div>
  )
}
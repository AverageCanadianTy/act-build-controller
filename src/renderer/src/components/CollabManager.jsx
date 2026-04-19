import { useState, useEffect } from 'react'

export default function CollabManager({ projectFilePath, activeUser, onClose }) {
const [tokens, setTokens] = useState([])
const [loading, setLoading] = useState(true)
const [generating, setGenerating] = useState(false)
const [newLabel, setNewLabel] = useState('')
const [generatedToken, setGeneratedToken] = useState(null)
const [copied, setCopied] = useState(false)
const [error, setError] = useState(null)

const loadTokens = async () => {
  if (!projectFilePath || !activeUser) return
  const result = await window.api.getCollabTokens({ projectFilePath, ownerId: activeUser.id })
  if (result.success) setTokens(result.tokens)
  setLoading(false)
}

useEffect(() => { loadTokens() }, [projectFilePath, activeUser])

const handleGenerate = async () => {
  if (!newLabel.trim()) return
  setGenerating(true)
  setError(null)
  const result = await window.api.generateCollabToken({ projectFilePath, ownerId: activeUser.id, label: newLabel.trim() })
  setGenerating(false)
  if (!result.success) { setError(result.error); return }
  setGeneratedToken(result.token)
  setNewLabel('')
  setCopied(false)
  await loadTokens()
}

const handleCopy = () => {
  navigator.clipboard.writeText(generatedToken)
  setCopied(true)
}

const handleRevoke = async (tokenId) => {
  const result = await window.api.revokeCollabToken({ projectFilePath, ownerId: activeUser.id, tokenId })
  if (result.success) await loadTokens()
}

const activeTokens = tokens.filter(t => !t.used)
const usedTokens = tokens.filter(t => t.used)

return (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel modal-panel-sm" onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title">
          <span className="modal-label">Project</span>
          <span className="modal-domain-name">Collaboration Tokens</span>
        </div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="collab-body">
        <div className="collab-generate">
          <div className="collab-section-label">Generate Invite Token</div>
          <div className="collab-generate-row">
            <input
              className="login-input"
              placeholder="Token name (e.g. For Alex)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newLabel.trim()) handleGenerate() }}
            />
            <button
              className="picker-btn picker-btn-primary collab-gen-btn"
              onClick={handleGenerate}
              disabled={generating || !newLabel.trim()}
            >
              {generating ? '...' : 'Generate'}
            </button>
          </div>
          {error && <div className="login-error" style={{ marginTop: 6 }}>{error}</div>}
        </div>

        {generatedToken && (
          <div className="collab-token-reveal">
            <div className="collab-reveal-warning">⚠ Copy this token now — it will not be shown again.</div>
            <div className="collab-reveal-row">
              <code className="collab-token-value">{generatedToken}</code>
              <button className="collab-copy-btn" onClick={handleCopy}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <button className="collab-dismiss-btn" onClick={() => setGeneratedToken(null)}>
              I've copied it — dismiss
            </button>
          </div>
        )}

        {!loading && (
          <div className="collab-token-list">
            <div className="collab-section-label">
              Active Tokens {activeTokens.length > 0 && <span className="collab-count">{activeTokens.length}</span>}
            </div>
            {activeTokens.length === 0 ? (
              <div className="collab-empty">No active tokens.</div>
            ) : (
              activeTokens.map(t => (
                <div key={t.id} className="collab-token-row">
                  <div className="collab-token-info">
                    <span className="collab-token-label">{t.label}</span>
                    <span className="collab-token-date">{new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                  <button className="collab-revoke-btn" onClick={() => handleRevoke(t.id)}>Revoke</button>
                </div>
              ))
            )}
            {usedTokens.length > 0 && (
              <>
                <div className="collab-section-label" style={{ marginTop: 12 }}>
                  Used Tokens <span className="collab-count">{usedTokens.length}</span>
                </div>
                {usedTokens.map(t => (
                  <div key={t.id} className="collab-token-row collab-token-used">
                    <div className="collab-token-info">
                      <span className="collab-token-label">{t.label}</span>
                      <span className="collab-token-date">{new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className="collab-used-badge">Redeemed</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
    )
}
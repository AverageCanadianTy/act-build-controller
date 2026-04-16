import { useState } from 'react'

export default function OAuthSetup({ onSuccess, onClose }) {
  const [credentials, setCredentials] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  const handleUpload = async () => {
    const filePath = await window.api.selectFile([{ name: 'Client Secret JSON', extensions: ['json'] }])
    if (!filePath) return
    const result = await window.api.parseClientSecretFile(filePath)
    if (!result.success) { setError(result.error); return }
    setCredentials(result)
    setError(null)
  }

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    const result = await window.api.startOAuthFlow({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret
    })
    setConnecting(false)
    if (!result.success) { setError(result.error); return }
    setDone(true)
    setTimeout(onSuccess, 1200)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-label">Sheet Tracker</span>
            <span className="modal-domain-name">Connect Google Account</span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body-pad">
          {done ? (
            <div className="oauth-success">✓ Connected successfully!</div>
          ) : (
            <>
              <div className="oauth-steps">
                <p className="oauth-step-text">
                  <strong>Step 1</strong> — Go to{' '}
                  <span
                    className="oauth-link"
                    onClick={() => window.api.openExternal('https://console.cloud.google.com/apis/credentials')}
                  >
                    Google Cloud Console
                  </span>{' '}
                  → Create credentials → OAuth 2.0 Client ID → Application type: <strong>Desktop app</strong> → Download JSON.
                </p>
                <p className="oauth-step-text">
                  <strong>Step 2</strong> — Enable the <strong>Google Sheets API</strong> for your project in{' '}
                  <span
                    className="oauth-link"
                    onClick={() => window.api.openExternal('https://console.cloud.google.com/apis/library/sheets.googleapis.com')}
                  >
                    API Library
                  </span>.
                </p>
                <p className="oauth-step-text">
                  <strong>Step 3</strong> — Upload the downloaded <code>client_secret_*.json</code> file below.
                </p>
              </div>

              <button
                className={`oauth-upload-btn${credentials ? ' oauth-upload-btn-done' : ''}`}
                onClick={handleUpload}
              >
                {credentials
                  ? `✓ ${credentials.clientId.slice(0, 30)}...`
                  : '↑ Upload client_secret.json'}
              </button>

              {error && <div className="sheet-id-error" style={{ marginTop: 10 }}>{error}</div>}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-cancel-btn" onClick={onClose}>Cancel</button>
          {!done && (
            <button
              className="modal-done-btn"
              onClick={handleConnect}
              disabled={!credentials || connecting}
            >
              {connecting ? 'Waiting for browser…' : 'Connect Account →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
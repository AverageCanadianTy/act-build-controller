import { useState, useEffect } from 'react'

export default function LoginScreen({ onLogin }) {
  const [users, setUsers] = useState([])
  const [mode, setMode] = useState('login')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [autoLogin, setAutoLogin] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    window.api.getUsers().then(u => {
      setUsers(u)
      if (u.length === 0) setMode('register')
      const auto = u.find(x => x.autoLogin)
      if (auto) {
        setDisplayName(auto.displayName)
      }
    })
  }, [])

  const handleLogin = async () => {
    if (!displayName || !password) return
    setLoading(true)
    setError(null)
    const result = await window.api.loginUser({ displayName, password })
    setLoading(false)
    if (!result.success) { setError(result.error); return }
    if (autoLogin !== result.user.autoLogin) {
      await window.api.updateAutoLogin({ userId: result.user.id, autoLogin })
    }
    onLogin(result.user)
  }

  const handleRegister = async () => {
    if (!displayName.trim()) { setError('Display name required'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    setError(null)
    const result = await window.api.registerUser({ displayName: displayName.trim(), password })
    setLoading(false)
    if (!result.success) { setError(result.error); return }
    if (autoLogin) await window.api.updateAutoLogin({ userId: result.user.id, autoLogin: true })
    onLogin(result.user)
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="login-brand">
          <div className="picker-logo">⬡</div>
          <h1 className="picker-title">ACT Build Controller</h1>
          <p className="picker-subtitle">Matrix Orchestration System</p>
        </div>

        <div className="login-tabs">
          <button
            className={`login-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => { setMode('login'); setError(null) }}
            disabled={users.length === 0}
          >
            Sign In
          </button>
          <button
            className={`login-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => { setMode('register'); setError(null) }}
          >
            Register
          </button>
        </div>

        <div className="login-fields">
          {mode === 'login' && users.length > 0 ? (
            <select
              className="login-select"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
            >
              <option value="">Select user...</option>
              {users.map(u => (
                <option key={u.id} value={u.displayName}>{u.displayName}</option>
              ))}
            </select>
          ) : (
            <input
              className="login-input"
              placeholder="Display name"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              autoFocus
            />
          )}

          <input
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') mode === 'login' ? handleLogin() : handleRegister() }}
          />

          {mode === 'register' && (
            <input
              className="login-input"
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRegister() }}
            />
          )}

          <label className="absolute-toggle" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              checked={autoLogin}
              onChange={e => setAutoLogin(e.target.checked)}
            />
            <span>Remember me on this machine</span>
          </label>
        </div>

        {error && <div className="login-error">{error}</div>}

        <button
          className="picker-btn picker-btn-primary"
          onClick={mode === 'login' ? handleLogin : handleRegister}
          disabled={loading || !displayName || !password}
        >
          {loading ? '...' : mode === 'login' ? 'Sign In →' : 'Create Account →'}
        </button>
      </div>
    </div>
  )
}
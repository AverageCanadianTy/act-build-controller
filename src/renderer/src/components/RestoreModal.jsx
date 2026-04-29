import { useState, useEffect, useRef } from 'react'

const DIRECTION_LABEL = { ROLLBACK: 'ROLLBACK', UPDATE: 'UPDATE', RESTORE: 'RESTORE' }

export default function RestoreModal({ project, projectFilePath, onClose, onApplied }) {
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState(null)
  const [stageData, setStageData] = useState(null)
  const [depActions, setDepActions] = useState({})
  const [miniLogs, setMiniLogs] = useState([])
  const termRef = useRef(null)

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [miniLogs])

  const appendLog = (line) => setMiniLogs(prev => [...prev.slice(-120), line])

  // ── Step 1 — Stage ────────────────────────────────────────────────────────
  const handleSelectXml = async () => {
    const xmlPath = await window.api.selectFile([{ name: 'ACT Matrix', extensions: ['xml'] }])
    if (!xmlPath) return
    setPhase('staging')
    setError(null)
    setMiniLogs([])
    const result = await window.api.stageRestore({ xmlPath, projectFilePath })
    if (!result.success) {
      setError(result.error)
      setPhase('error')
      return
    }
    // Build depActions: require = in staging not installed; remove = installed not in staging
    const installed = result.currentInstalled
    const staging = result.stagingDeps
    const actions = {}
    staging.forEach(dep => {
      if (!installed.includes(dep)) actions[dep] = { type: 'install', checked: true }
    })
    installed.forEach(dep => {
      if (!staging.includes(dep)) actions[dep] = { type: 'remove', checked: false }
    })
    setStageData(result)
    setDepActions(actions)
    setPhase('dep_review')
  }

  // ── Step 2 → 3 — Validate ────────────────────────────────────────────────
  const handleContinueToValidate = async () => {
    setPhase('validating')
    const unsub = window.api.onLog(appendLog)
        const result = await window.api.validateRestore({ stagingPath: stageData.stagingPath })
    unsub()
    if (!result.success) {
      appendLog(`\n[✗ Stack link failed — check that node_modules exists in the project root]`)
    }
    setPhase('testing')
  }

  // ── Step 4 — Test ────────────────────────────────────────────────────────
  const handleTest = () => {
    if (!project.runCommand) return
    setMiniLogs([])
    window.api.runScript({ command: project.runCommand, cwd: stageData.stagingPath })
  }

  // ── Step 5a — Apply ──────────────────────────────────────────────────────
  const handleApply = async () => {
    setPhase('applying')
    const result = await window.api.applyRestore({
      projectRoot: project.rootPath,
      stagingPath: stageData.stagingPath
    })
    if (!result.success) { setError(result.error); setPhase('error'); return }
    setPhase('done')
  }

  // ── Step 5b — Abort ──────────────────────────────────────────────────────
  const handleAbort = async () => {
    if (stageData?.stagingPath) {
      await window.api.abortRestore({ stagingPath: stageData.stagingPath })
    }
    onClose()
  }

  const dirClass = stageData?.direction?.toLowerCase() || ''

  return (
    <div className="modal-overlay">
      <div className="restore-modal-panel">
        <div className="modal-header">
          <h2>
            {phase === 'idle' && 'Restore from Matrix'}
                        {phase === 'staging' && 'Staging…'}
            {phase === 'dep_review' && `${DIRECTION_LABEL[stageData?.direction] || 'REVIEW'} — v${stageData?.uploadedVersion}`}
            {phase === 'validating' && 'Linking Stack…'}
            {phase === 'testing' && 'Test the Restored App'}
            {phase === 'applying' && 'Applying…'}
            {phase === 'done' && 'Restore Complete'}
            {phase === 'error' && 'Restore Failed'}
          </h2>
          {phase !== 'applying' && phase !== 'staging' && (
            <button className="modal-close-x" onClick={handleAbort}>✕</button>
          )}
        </div>

        <div className="restore-modal-body">
          {/* IDLE */}
          {phase === 'idle' && (
            <div className="restore-idle-block">
              <p>Upload a prior ACT Matrix XML snapshot to roll back, update, or re-apply your codebase.</p>
              <p className="restore-warning">⚠ This will replace your project root. Ensure your current work is committed.</p>
              <button className="run-btn" onClick={handleSelectXml}>Select Matrix XML…</button>
            </div>
          )}

          {/* STAGING SPINNER */}
          {phase === 'staging' && (
            <div className="restore-spinner-block">
              <div className="restore-spinner" />
              <span>Extracting files to staging…</span>
            </div>
          )}

          {/* DEP REVIEW */}
          {phase === 'dep_review' && (
            <div className="restore-dep-review">
              <div className={`restore-direction-badge ${dirClass}`}>
                {stageData.direction} — v{stageData.currentVersion} → v{stageData.uploadedVersion}
              </div>
              {Object.keys(depActions).length === 0 && (
                <p className="restore-dep-clear">✓ No dependency changes required.</p>
              )}
              {Object.entries(depActions).filter(([,v]) => v.type === 'install').length > 0 && (
                <div className="dep-delta-section">
                  <div className="dep-delta-label">Required by restore</div>
                  {Object.entries(depActions).filter(([,v]) => v.type === 'install').map(([dep, meta]) => (
                    <label key={dep} className="dep-delta-row">
                      <input type="checkbox" checked={meta.checked}
                        onChange={e => setDepActions(prev => ({ ...prev, [dep]: { ...meta, checked: e.target.checked } }))} />
                      <span className="dep-add">+ {dep}</span>
                    </label>
                  ))}
                </div>
              )}
              {Object.entries(depActions).filter(([,v]) => v.type === 'remove').length > 0 && (
                <div className="dep-delta-section">
                  <div className="dep-delta-label">Unused after restore</div>
                  {Object.entries(depActions).filter(([,v]) => v.type === 'remove').map(([dep, meta]) => (
                    <label key={dep} className="dep-delta-row">
                      <input type="checkbox" checked={meta.checked}
                        onChange={e => setDepActions(prev => ({ ...prev, [dep]: { ...meta, checked: e.target.checked } }))} />
                      <span className="dep-remove">− {dep}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VALIDATING / TESTING — shared mini terminal */}
          {(phase === 'validating' || phase === 'testing') && (
            <div className="restore-mini-terminal" ref={termRef}>
              {miniLogs.length === 0
                ? <span className="terminal-empty">Waiting for output…</span>
                : miniLogs.map((l, i) => <div key={i} className="log-line">{l}</div>)
              }
            </div>
          )}

          {phase === 'testing' && (
            <div className="restore-test-prompt">
              {project.runCommand
                ? <button className="run-btn" onClick={handleTest}>▶ Run {project.runCommand}</button>
                : <p className="restore-warning">No run command configured. Confirm visually if already running.</p>
              }
              <p>Did the app load correctly?</p>
            </div>
          )}

          {phase === 'applying' && (
            <div className="restore-spinner-block"><div className="restore-spinner" /><span>Applying…</span></div>
                    )}
          {phase === 'done' && (
            <div className="restore-done-block">
              <p className="restore-done">✓ Codebase restored successfully. Restart ACT to reload the project.</p>
              <p className="restore-done-hint">Run <code>npm install</code> in your project root to reconcile any dependency changes flagged during the restore review.</p>
            </div>
          )}
          {phase === 'error' && (
            <p className="restore-error-msg">✗ {error}</p>
          )}
        </div>

        <div className="restore-actions">
          {phase === 'dep_review' && (
            <>
              <button className="restore-abort-btn" onClick={handleAbort}>Abort</button>
              <button className="run-btn" onClick={handleContinueToValidate}>Continue →</button>
            </>
          )}
          {phase === 'testing' && (
            <>
              <button className="restore-abort-btn" onClick={handleAbort}>No — Abort</button>
              <button className="run-btn" onClick={handleApply}>Yes — Apply</button>
            </>
          )}
          {phase === 'done' && (
            <button className="run-btn" onClick={onClose}>Close</button>
          )}
          {phase === 'error' && (
            <button className="restore-abort-btn" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
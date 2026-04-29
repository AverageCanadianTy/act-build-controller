import { useState, useRef } from 'react'

// ── Diff Validation ──────────────────────────────────────────────────────────
function isValidUnifiedDiff(text) {
  if (!text || typeof text !== 'string') return false
  const strippedHeaders = text.replace(/^---.*$/m, '').replace(/^\+\+\+.*$/m, '')
  return (
    /^--- /m.test(text) &&
    /^\+\+\+ /m.test(text) &&
    /@@ -\d+,?\d* \+\d+,?\d* @@/m.test(text) &&
    /^[+-]/m.test(strippedHeaders)
  )
}

function hasMinContext(text) {
  const hunks = text.split(/^@@[^\n]*\n/m).slice(1)
  for (const hunk of hunks) {
    const lines = hunk.split('\n').filter(l => l !== '')
    const contextBefore = []
    const contextAfter = []
    let changeFound = false
    let hasLinesAfterChange = false
    for (const l of lines) {
      const isChange = l.startsWith('+') || l.startsWith('-')
      const isContext = l.startsWith(' ')
      if (!changeFound && isContext) {
        const content = l.slice(1).trim()
        if (content) contextBefore.push(content)
      }
      if (isChange) changeFound = true
      if (changeFound && isContext) {
        hasLinesAfterChange = true
        const content = l.slice(1).trim()
        if (content) contextAfter.push(content)
      }
    }
    if (contextBefore.length < 2 && (!hasLinesAfterChange || contextAfter.length < 2)) {
      return { ok: false, edgeCase: null, reason: 'Fewer than 2 non-blank context lines on both sides. Add more context.' }
    }
    if (contextBefore.length < 2) {
      return { ok: false, edgeCase: 'start', reason: null }
    }
    if (hasLinesAfterChange && contextAfter.length < 2) {
      return { ok: false, edgeCase: 'end', reason: null }
    }
  }
  return { ok: true, edgeCase: null }
}

function extractFilePath(text) {
  const m = text.match(/^\+\+\+ (.+)$/m)
  if (!m) return null
  // Strip leading b/ (git-style), strip trailing timestamps
  return m[1].trim().replace(/^b\//, '').split('\t')[0].trim()
}

function parseHunks(text) {
  const lines = text.split('\n')
  const hunks = []
  let current = null
  for (const line of lines) {
    if (/^@@ /.test(line)) {
      if (current) hunks.push(current)
      current = { header: line, lines: [] }
    } else if (current) {
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
        current.lines.push(line)
      }
    }
  }
  if (current) hunks.push(current)
  return hunks
}

// ── Slot Factory ─────────────────────────────────────────────────────────────
let _sid = 0
const makeSlot = () => ({
  id: `s${++_sid}`,
  filePath: null,
  hunks: [],
  hunkCount: 0,
  status: 'idle',
  error: null,
  loadError: null,
  pendingConfirm: null  // { filePath, hunks, edgeCase: 'start'|'end' }
})

// ── Component ────────────────────────────────────────────────────────────────
export default function CodePatcher({ project }) {
  const [slots, setSlots] = useState(() => [makeSlot()])
  const [flashing, setFlashing] = useState(new Set())
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [autoRegen, setAutoRegen] = useState(true)
  const timers = useRef({})
  console.log('PROJECT TARGETS', JSON.stringify(project?.targets))
  const rootPath = project?.targets?.find((t) => t.isRoot || t.class === 'Root')?.folderPath

  // ── Flash a slot red ─────────────────────────────────────────────────────
  const flashRed = (id) => {
    setFlashing((prev) => new Set([...prev, id]))
    setTimeout(
      () =>
        setFlashing((prev) => {
          const n = new Set(prev)
          n.delete(id)
          return n
        }),
      600
    )
  }

  // ── Load diff from clipboard ─────────────────────────────────────────────
const handleLoad = async (slotId) => {
    let text
    try {
      text = await navigator.clipboard.readText()
    } catch {
      flashRed(slotId)
      return
    }

    if (!isValidUnifiedDiff(text)) {
      setSlots(prev => prev.map(s =>
        s.id === slotId ? { ...s, loadError: 'Clipboard content is not a valid unified diff.' } : s
      ))
      flashRed(slotId)
      return
    }

        const filePath = extractFilePath(text)
    if (!filePath) {
      flashRed(slotId)
      return
    }

    const isNewFile = /^--- \/dev\/null/m.test(text)
    if (isNewFile) {
      const hunks = parseHunks(text)
      setSlots(prev => prev.map(s =>
        s.id === slotId
          ? { ...s, loadError: null, pendingConfirm: { filePath, hunks, edgeCase: 'newfile' } }
          : s
      ))
      return
    }

    const hunks = parseHunks(text)
    if (hunks.length === 0) {
      flashRed(slotId)
      return
    }

    const contextCheck = hasMinContext(text)
    if (!contextCheck.ok) {
      if (contextCheck.edgeCase) {
        setSlots(prev => prev.map(s =>
          s.id === slotId
            ? { ...s, loadError: null, pendingConfirm: { filePath, hunks, edgeCase: contextCheck.edgeCase } }
            : s
        ))
        return
      }
      setSlots(prev => prev.map(s =>
        s.id === slotId ? { ...s, loadError: contextCheck.reason } : s
      ))
      flashRed(slotId)
      return
    }

    setSlots((prev) => {
      const slot = prev.find((s) => s.id === slotId)
      if (!slot) return prev

      if (!slot.filePath) {
        if (prev.some((s) => s.id !== slotId && s.filePath === filePath)) {
          setTimeout(() => flashRed(slotId), 0)
          return prev
        }
        return prev.map((s) =>
          s.id === slotId
            ? { ...s, filePath, hunks, hunkCount: hunks.length, status: 'idle', error: null, loadError: null }
            : s
        )
      }

      if (slot.filePath === filePath) {
        const merged = [...slot.hunks, ...hunks]
        return prev.map((s) =>
          s.id === slotId
            ? { ...s, hunks: merged, hunkCount: merged.length, status: 'idle', error: null, loadError: null }
            : s
        )
      }

      setTimeout(() => flashRed(slotId), 0)
      return prev
    })
  }

   const confirmEdgeLoad = (slotId) => {
    setSlots(prev => prev.map(s => {
      if (s.id !== slotId || !s.pendingConfirm) return s
      const { filePath, hunks } = s.pendingConfirm
      return {
        ...s,
        filePath,
        hunks,
        hunkCount: hunks.length,
        status: 'idle',
        error: null,
        loadError: null,
        pendingConfirm: null
      }
    }))
  }

  const cancelEdgeLoad = (slotId) => {
    setSlots(prev => prev.map(s =>
      s.id === slotId ? { ...s, pendingConfirm: null } : s
    ))
  }

  // ── Add a slot ───────────────────────────────────────────────────────────
  const handleAddSlot = () => {
    setSlots((prev) => [...prev, makeSlot()])
  }

  // ── Remove a slot (with inline confirm for loaded slots) ─────────────────
  const handleRemove = (slotId) => {
    const slot = slots.find((s) => s.id === slotId)
    if (!slot) return

    if (slot.hunkCount > 0 && confirmDelete !== slotId) {
      setConfirmDelete(slotId)
      clearTimeout(timers.current[slotId])
      timers.current[slotId] = setTimeout(
        () => setConfirmDelete((c) => (c === slotId ? null : c)),
        3000
      )
      return
    }

    clearTimeout(timers.current[slotId])
    setConfirmDelete(null)
    setSlots((prev) => {
      const next = prev.filter((s) => s.id !== slotId)
      return next.length === 0 ? [makeSlot()] : next
    })
  }

  const cancelDelete = (slotId) => {
    clearTimeout(timers.current[slotId])
    setConfirmDelete(null)
  }

  // ── Auto-regen matrix after successful deploy ─────────────────────────────
  const triggerRegen = async () => {
    if (!project?.knowledgePath || !rootPath) return
    try {
      await window.api.ensureSubfolder({
        knowledgePath: project.knowledgePath,
        subfolderName: 'root-file-matrices'
      })
      const nextV = await window.api.scanOutputVersion({
        folderPath: `${project.knowledgePath}/root-file-matrices`,
        projectName: project.name,
        targetClass: null
      })
      const sName = project.name
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '')
      const filename = `${sName}_file_matrix_v${nextV}.xml`
      window.api.runScript(
        `cd "${rootPath}" && repomix --output "${project.knowledgePath}/root-file-matrices/${filename}"`
      )
    } catch {
      // Regen failure is non-blocking
    }
  }

  // ── Core deploy logic (shared by slot deploy + deploy all) ───────────────
const executeDeploy = async (patchList, slotIds) => {
    if (!rootPath || patchList.length === 0) return

    try {
      if (typeof window.api?.applyPatches !== 'function') {
        setSlots((prev) => prev.map((s) =>
          slotIds.includes(s.id)
            ? { ...s, status: 'failed', error: 'applyPatches not found on window.api — check preload diff was applied correctly' }
            : s
        ))
        return
      }

      const result = await window.api.applyPatches({ patches: patchList, rootPath })

      setSlots((prev) => {
        let ri = 0
        return prev.map((s) => {
          if (!slotIds.includes(s.id)) return s
          const r = result.results[ri++]
          if (!r) return s
          return r.success
            ? { ...s, status: 'deployed' }
            : { ...s, status: 'failed', error: r.error }
        })
      })

      if (result.results.every((r) => r.success) && autoRegen) {
        await triggerRegen()
      }
    } catch (err) {
      setSlots((prev) => prev.map((s) =>
        slotIds.includes(s.id)
          ? { ...s, status: 'failed', error: err.message || 'Unknown error during deploy' }
          : s
      ))
    }
  }

const handleDeploySlot = (slotId) => {
    const slot = slots.find((s) => s.id === slotId)
    console.log('DEPLOY SLOT', slotId, slot?.filePath, slot?.hunkCount, slot?.status, 'rootPath:', rootPath)
    if (!slot || !slot.filePath || slot.hunkCount === 0 || slot.status === 'deployed') return
    executeDeploy([{ targetPath: slot.filePath, hunks: slot.hunks }], [slotId])
  }

  const handleDeployAll = () => {
    const ready = slots.filter(
      (s) => s.filePath && s.hunkCount > 0 && s.status !== 'deployed'
    )
    if (ready.length === 0) return
    executeDeploy(
      ready.map((s) => ({ targetPath: s.filePath, hunks: s.hunks })),
      ready.map((s) => s.id)
    )
  }

  // ── Derived state ────────────────────────────────────────────────────────
  const lastSlot = slots[slots.length - 1]
  const canAddSlot = !!lastSlot?.filePath
  const deployableCount = slots.filter(
    (s) => s.filePath && s.hunkCount > 0 && s.status !== 'deployed'
  ).length

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="patcher-view">
      <h1>Code Patcher</h1>

      <div className="patcher-slots">
        {slots.map((slot) => {
          const isFlashing = flashing.has(slot.id)
          const isPendingDelete = confirmDelete === slot.id
          const isDeployed = slot.status === 'deployed'
          const isFailed = slot.status === 'failed'

          return (
            <div
              key={slot.id}
              className={`patcher-slot${isDeployed ? ' is-deployed' : ''}${isFailed ? ' is-failed' : ''}`}
            >
              <div className="patcher-slot-main">
                {/* Load / file-lock button */}
                <button
                  className={`patcher-load-btn${isFlashing ? ' is-invalid' : ''}`}
                  onClick={() => handleLoad(slot.id)}
                  disabled={isDeployed}
                  title={
                    isDeployed
                      ? 'Patch deployed'
                      : slot.filePath
                        ? `Locked to ${slot.filePath} — paste another diff for this file to add hunks`
                        : 'Click to load a unified diff from clipboard'
                  }
                >
                  <span className="patcher-load-icon">📋</span>
                  {slot.filePath ? (
                    <span className="patcher-slot-path">{slot.filePath}</span>
                  ) : (
                    <span className="patcher-slot-placeholder">Load Diff from Clipboard</span>
                  )}
                  {slot.hunkCount > 0 && !isDeployed && (
                    <span className="patcher-hunk-badge">
                      {slot.hunkCount} {slot.hunkCount === 1 ? 'hunk' : 'hunks'}
                    </span>
                  )}
                  {isDeployed && <span className="patcher-deployed-badge">✓ Deployed</span>}
                </button>

                {/* Per-slot actions */}
                <div className="patcher-slot-actions">
                  {slot.filePath && !isDeployed && (
                    <button
                      className="patcher-deploy-slot-btn"
                      onClick={() => handleDeploySlot(slot.id)}
                      title={`Deploy ${slot.filePath}`}
                    >
                      ▶
                    </button>
                  )}

                  {isPendingDelete ? (
                    <div className="patcher-delete-confirm">
                      <button
                        className="patcher-confirm-btn"
                        onClick={() => handleRemove(slot.id)}
                      >
                        ✓ Remove
                      </button>
                      <button
                        className="patcher-cancel-btn"
                        onClick={() => cancelDelete(slot.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="patcher-remove-btn"
                      onClick={() => handleRemove(slot.id)}
                      title="Remove this slot"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {isFailed && slot.error && (
                <div className="patcher-error-row">✗ {slot.error}</div>
              )}
                            {slot.pendingConfirm && (
                <div className="patcher-edge-confirm">
                  <span className="patcher-edge-msg">
                    ⚠ {slot.pendingConfirm.edgeCase === 'newfile'
                      ? `Create new file: '${slot.pendingConfirm.filePath}'?`
                      : slot.pendingConfirm.edgeCase === 'start'
                      ? 'Is this change at the beginning of the file?'
                      : 'Is this change at the end of the file?'}
                  </span>
                  <div className="patcher-edge-btns">
                    <button className="patcher-confirm-btn" onClick={() => confirmEdgeLoad(slot.id)}>
                      ✓ Yes, load it
                    </button>
                    <button className="patcher-cancel-btn" onClick={() => cancelEdgeLoad(slot.id)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <div className="patcher-add-row">
          <button
            className={`patcher-add-btn${!canAddSlot ? ' is-gated' : ''}`}
            onClick={handleAddSlot}
            disabled={!canAddSlot}
            title={!canAddSlot ? 'Load a diff into the last slot first' : 'Add a new patch slot'}
          >
            + Add Slot
          </button>
        </div>
      </div>

      <div className="patcher-footer">
        <label className="patcher-regen-label">
          <input
            type="checkbox"
            checked={autoRegen}
            onChange={(e) => setAutoRegen(e.target.checked)}
          />
          Regenerate file matrix after deploy
        </label>
        <div className="patcher-footer-btns">
          <button
            className="patcher-clear-btn"
            onClick={() =>
              setSlots((prev) => {
                const kept = prev.filter((s) => s.status !== 'deployed')
                return kept.length === 0 ? [makeSlot()] : kept
              })
            }
          >
            Clear Deployed
          </button>
          <button
            className={`patcher-deploy-all-btn${deployableCount === 0 ? ' is-disabled' : ''}`}
            onClick={handleDeployAll}
            disabled={deployableCount === 0}
          >
            ▶ Deploy All{deployableCount > 0 ? ` (${deployableCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

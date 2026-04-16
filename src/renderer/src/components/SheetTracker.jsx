import { useState } from 'react'

const PILL_LIMIT = 12

function toSheetSubfolder(label) {
  return `${label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-sheet-matrices`
}

// ── Single sheet group ─────────────────────────────────────────────────────
function SheetGroup({ group, knowledgePath, onUpdateLabel, onRemove, onAddSheet, onRemoveSheet, onImport, onGenerateScript }) {
  const [expanded, setExpanded] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [validating, setValidating] = useState(false)
  const [inputError, setInputError] = useState(null)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(group.label)
  const [scriptGenerated, setScriptGenerated] = useState(null)

  const visible = expanded ? group.sheetIds : group.sheetIds.slice(0, PILL_LIMIT)
  const hiddenCount = group.sheetIds.length - PILL_LIMIT

  const handleAdd = async () => {
    const trimmed = inputVal.trim()
    if (!trimmed) return
    setValidating(true)
    setInputError(null)
    const result = await window.api.validateSheetId(trimmed)
    setValidating(false)
    if (!result.valid) { setInputError(result.error || 'Invalid or inaccessible Sheet ID'); return }
    onAddSheet({ id: trimmed, label: result.title, validated: true })
    setInputVal('')
  }

  const handleGenerateScript = async () => {
    if (!knowledgePath) return
    const result = await window.api.generateSheetScript({ group, knowledgePath })
    if (result.success) setScriptGenerated(result.scriptPath)
  }

  const commitLabel = () => {
    if (labelVal.trim()) onUpdateLabel(labelVal.trim())
    setEditingLabel(false)
  }

  return (
    <div className="sheet-group">
      <div className="sheet-group-header">
        <div className="sheet-group-label-area">
          {editingLabel ? (
            <input
              className="sheet-group-label-input"
              value={labelVal}
              onChange={(e) => setLabelVal(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false) }}
              autoFocus
            />
          ) : (
            <span className="sheet-group-label" onDoubleClick={() => { setLabelVal(group.label); setEditingLabel(true) }}>
              {group.label}
            </span>
          )}
          <span className="sheet-group-count">{group.sheetIds.length}</span>
          {group.sheetIds.length > 0 && knowledgePath && (
            <span className="sheet-group-subfolder">→ {toSheetSubfolder(group.label)}/</span>
          )}
        </div>
        <div className="sheet-group-actions">
          <button className="sheet-group-import-btn" onClick={onImport} title="Import IDs from Python script">↑ Import</button>
          {knowledgePath && group.sheetIds.length > 0 && (
            <button className="sheet-group-script-btn" onClick={handleGenerateScript} title="Generate Python script to knowledge folder">
              ⚙ Script
            </button>
          )}
          <button className="target-remove-btn" onClick={onRemove}>✕</button>
        </div>
      </div>

      {scriptGenerated && (
        <div className="sheet-script-generated">
          ✓ Script written: <code>{scriptGenerated.split('/').slice(-1)[0]}</code>
        </div>
      )}

      {group.sheetIds.length > 0 && (
        <div className="sheet-pills">
          {visible.map((sheet) => (
            <div key={sheet.id} className="sheet-pill" title={`${sheet.label}\n${sheet.id}`}>
              <span className="sheet-pill-label">{sheet.label || `${sheet.id.slice(0, 10)}…`}</span>
              <button className="sheet-pill-remove" onClick={() => onRemoveSheet(sheet.id)}>×</button>
            </div>
          ))}
          {!expanded && hiddenCount > 0 && (
            <button className="sheet-pills-more" onClick={() => setExpanded(true)}>+{hiddenCount} more</button>
          )}
          {expanded && hiddenCount > 0 && (
            <button className="sheet-pills-more" onClick={() => setExpanded(false)}>show less</button>
          )}
        </div>
      )}

      <div className="sheet-add-row">
        <input
          className="sheet-id-input"
          placeholder="Paste Google Sheet ID…"
          value={inputVal}
          onChange={(e) => { setInputVal(e.target.value); setInputError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          disabled={validating}
        />
        <button
          className="sheet-add-btn"
          onClick={handleAdd}
          disabled={!inputVal.trim() || validating}
          title="Validate and add"
        >
          {validating ? '…' : '+'}
        </button>
      </div>
      {inputError && <div className="sheet-id-error">{inputError}</div>}
    </div>
  )
}

// ── Sheet Tracker panel ────────────────────────────────────────────────────
export default function SheetTracker({ project, oauthStatus, onUpdate, onOAuthRequest }) {
  const tracker = project.sheetTracker || { enabled: false, groups: [] }
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupLabel, setNewGroupLabel] = useState('')

  const updateTracker = (updater) => {
    const current = project.sheetTracker || { enabled: false, groups: [] }
    const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }
    onUpdate({ sheetTracker: next })
  }

  const handleToggle = (enabled) => {
    if (enabled && !oauthStatus?.hasToken) { onOAuthRequest(); return }
    updateTracker({ enabled })
  }

  const addGroup = () => {
    if (!newGroupLabel.trim()) return
    updateTracker(t => ({
      ...t,
      groups: [...t.groups, {
        id: `g${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        label: newGroupLabel.trim(),
        sheetIds: []
      }]
    }))
    setNewGroupLabel('')
    setAddingGroup(false)
  }

  const updateGroup = (groupId, updater) =>
    updateTracker(t => ({
      ...t,
      groups: t.groups.map(g => g.id === groupId
        ? (typeof updater === 'function' ? updater(g) : { ...g, ...updater })
        : g
      )
    }))

  const handleImportScript = async (groupId) => {
    const filePath = await window.api.selectFile([{ name: 'Python Script', extensions: ['py'] }])
    if (!filePath) return
    const result = await window.api.importSheetScript(filePath)
    if (!result.success || !result.groups?.length) return
    const allIds = result.groups.flatMap(g => g.sheetIds)
    updateGroup(groupId, g => ({
      ...g,
      sheetIds: [...g.sheetIds, ...allIds.filter(s => !g.sheetIds.find(e => e.id === s.id))]
    }))
  }

  return (
    <div className="sheet-tracker-panel">
      <div className="sheet-tracker-toggle-row">
        <label className="absolute-toggle">
          <input
            type="checkbox"
            checked={tracker.enabled}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          <span>Sheet Tracker</span>
        </label>
        {tracker.enabled && oauthStatus?.hasToken && (
          <span className="oauth-status-badge">🔑 Google Connected</span>
        )}
      </div>

      {tracker.enabled && !oauthStatus?.hasToken && (
        <div className="oauth-prompt">
          Google account not connected.
          <button className="oauth-connect-btn" onClick={onOAuthRequest}>Connect Account →</button>
        </div>
      )}

      {tracker.enabled && oauthStatus?.hasToken && (
        <>
          {tracker.groups.map(group => (
            <SheetGroup
              key={group.id}
              group={group}
              knowledgePath={project.knowledgePath}
              onUpdateLabel={(label) => updateGroup(group.id, { label })}
              onRemove={() => updateTracker(t => ({ ...t, groups: t.groups.filter(g => g.id !== group.id) }))}
              onAddSheet={(sheet) => updateGroup(group.id, g => ({ ...g, sheetIds: [...g.sheetIds, sheet] }))}
              onRemoveSheet={(id) => updateGroup(group.id, g => ({ ...g, sheetIds: g.sheetIds.filter(s => s.id !== id) }))}
              onImport={() => handleImportScript(group.id)}
            />
          ))}

          {addingGroup ? (
            <div className="add-group-form">
              <input
                className="sheet-group-new-input"
                placeholder="Group name (e.g. History, Playoff History)"
                value={newGroupLabel}
                onChange={(e) => setNewGroupLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addGroup()
                  if (e.key === 'Escape') { setAddingGroup(false); setNewGroupLabel('') }
                }}
                autoFocus
              />
              <button className="modal-done-btn" onClick={addGroup} disabled={!newGroupLabel.trim()}>Add</button>
              <button className="modal-cancel-btn" onClick={() => { setAddingGroup(false); setNewGroupLabel('') }}>Cancel</button>
            </div>
          ) : (
            <button className="add-group-btn" onClick={() => setAddingGroup(true)}>+ Add Sheet Group</button>
          )}
        </>
      )}
    </div>
  )
}
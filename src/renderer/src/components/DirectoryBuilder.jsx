import { useState } from 'react'

const IGNORE = {
  root: ['node_modules', 'dist', 'out', 'build', '.venv', '__pycache__', '*.pyc', '.pytest_cache', '*.egg-info', '*.log', '.DS_Store', 'modules'],
  frontend: ['node_modules', 'dist', 'out', 'build', '*.log', '.DS_Store'],
  backend: ['.venv', '__pycache__', '*.pyc', '.pytest_cache', '*.egg-info', '*.log', '.DS_Store']
}

const TYPE_CONFIG = {
  electron:  { label: 'Electron App',     core: ['frontend', 'docs'], optional: ['modules'], classes: ['FRONTEND'] },
  webapp:    { label: 'Web App',           core: ['frontend', 'docs'], optional: ['modules'], classes: ['FRONTEND'] },
  python:    { label: 'Python Backend',    core: ['backend', 'docs'],  optional: ['modules'], classes: ['BACKEND'] },
  fullstack: { label: 'Full-Stack',        core: ['frontend', 'backend', 'docs'], optional: ['modules'], classes: ['FRONTEND', 'BACKEND'] },
  blank:     { label: 'Blank / Custom',    core: ['docs'], optional: [], classes: [] }
}

const ALL_STEPS = ['Name', 'Type', 'Folders', 'Targets', 'Destination']

const slugify = (str) => str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

const pathJoin = (...parts) => {
  const sep = parts[0].includes('\\') ? '\\' : '/'
  return parts.join(sep)
}

const buildTargets = (type, projectRoot, activeFolders) => {
  const hasModules = activeFolders.includes('modules')
  const rootIgnore = IGNORE.root.filter(p => hasModules || p !== 'modules')
  const targets = [{ id: 'root', isRoot: true, class: null, folderPath: projectRoot, ignorePatterns: rootIgnore }]
  if (['electron', 'webapp', 'fullstack'].includes(type))
    targets.push({ id: 't_frontend', isRoot: false, class: 'FRONTEND', folderPath: pathJoin(projectRoot, 'frontend'), ignorePatterns: IGNORE.frontend })
  if (['python', 'fullstack'].includes(type))
    targets.push({ id: 't_backend', isRoot: false, class: 'BACKEND', folderPath: pathJoin(projectRoot, 'backend'), ignorePatterns: IGNORE.backend })
  return targets
}

export default function DirectoryBuilder({ onComplete, onClose }) {
  const [step, setStep] = useState(1)
  const [projectName, setProjectName] = useState('')
  const [nameError, setNameError] = useState(null)
  const [projectType, setProjectType] = useState(null)
  const [activeFolders, setActiveFolders] = useState([])
  const [customInput, setCustomInput] = useState('')
  const [destination, setDestination] = useState('')
  const [destError, setDestError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const folderName = slugify(projectName)
  const knowledgeName = `${folderName}-knowledge`
  const isBlank = projectType === 'blank'

  const validateName = () => {
    if (!projectName.trim()) { setNameError('Project name is required'); return false }
    if (!/^[a-zA-Z0-9 -]+$/.test(projectName.trim())) { setNameError('Alphanumeric, spaces, and hyphens only'); return false }
    setNameError(null)
    return true
  }

  const getTargets = () => {
    if (!destination || !folderName) return []
    return buildTargets(projectType, pathJoin(destination, folderName), activeFolders)
  }

  const handleCreate = async () => {
    if (!destination) { setDestError('Please select a destination folder'); return }
    setCreating(true)
    setCreateError(null)
    try {
      const result = await window.api.createProjectDirectory({
        projectName: projectName.trim(),
        projectType,
        destination,
        folders: isBlank ? ['docs'] : activeFolders,
        targets: isBlank ? [] : getTargets()
      })
      if (!result.success) { setCreateError(result.error || 'Creation failed'); setCreating(false); return }
      onComplete(result.projectData, result.projectFilePath)
    } catch (e) { setCreateError(e.message); setCreating(false) }
  }

  const goNext = () => {
    if (step === 1) { if (!validateName()) return; setStep(2) }
    else if (step === 2) {
      if (!projectType) return
      if (isBlank) { setStep(5) }
      else { setActiveFolders([...TYPE_CONFIG[projectType].core, ...TYPE_CONFIG[projectType].optional]); setStep(3) }
    }
    else if (step === 3) setStep(4)
    else if (step === 4) setStep(5)
    else if (step === 5) handleCreate()
  }

  const goBack = () => {
    if (step === 5 && isBlank) setStep(2)
    else if (step > 1) setStep(step - 1)
  }

  const addCustomFolder = () => {
    const val = customInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!val || activeFolders.includes(val)) return
    setActiveFolders(prev => [...prev, val])
    setCustomInput('')
  }

  const isLastStep = step === 5
  const isNextDisabled = (step === 1 && !projectName.trim()) || (step === 2 && !projectType) || (isLastStep && (!destination || creating))

  const renderStepIndicator = () => (
    <div className="wizard-steps">
      {ALL_STEPS.map((label, i) => {
        const s = i + 1
        const skipped = isBlank && (s === 3 || s === 4)
        return (
          <div key={s} className={`wizard-step-item${step === s ? ' active' : ''}${step > s && !skipped ? ' done' : ''}${skipped ? ' skipped' : ''}`}>
            <span className="wizard-step-num">{s}</span>
            <span className="wizard-step-label">{label}</span>
          </div>
        )
      })}
    </div>
  )

  const coreFolders = projectType ? TYPE_CONFIG[projectType].core : []

  const renderStep = () => {
    if (step === 1) return (
      <div className="wizard-body">
        <div className="wizard-field-label">Project Name</div>
        <input className="wizard-input" placeholder="My Awesome App" value={projectName}
          onChange={e => { setProjectName(e.target.value); setNameError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') goNext() }} autoFocus />
        {nameError && <div className="wizard-error">{nameError}</div>}
        {projectName.trim() && !nameError && (
          <div className="wizard-hint">Folder: <code>{folderName}/</code> · Knowledge: <code>{knowledgeName}/</code></div>
        )}
      </div>
    )
    if (step === 2) return (
      <div className="wizard-body">
        <div className="wizard-field-label">What are you building?</div>
        <div className="wizard-type-list">
          {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
            <label key={key} className={`wizard-type-option${projectType === key ? ' selected' : ''}`}>
              <input type="radio" name="projectType" value={key} checked={projectType === key} onChange={() => setProjectType(key)} />
              {cfg.label}
            </label>
          ))}
        </div>
      </div>
    )
    if (step === 3) return (
      <div className="wizard-body">
        <div className="wizard-field-label">Project Folders</div>
        <div className="wizard-hint-sm">These folders will be created in your project.</div>
        <div className="wizard-folder-list">
          {activeFolders.map(folder => (
            <div key={folder} className="wizard-folder-item">
              <span className="wizard-folder-check">✓</span>
              <span className="wizard-folder-name">{folder}/</span>
              {coreFolders.includes(folder)
                ? <span className="wizard-folder-core">core</span>
                : <button className="wizard-folder-remove" onClick={() => setActiveFolders(prev => prev.filter(f => f !== folder))}>✕</button>}
            </div>
          ))}
        </div>
        <div className="wizard-add-folder-row">
          <input className="wizard-input-sm" placeholder="custom-folder" value={customInput}
            onChange={e => setCustomInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') addCustomFolder() }} />
          <button className="wizard-add-folder-btn" onClick={addCustomFolder} disabled={!customInput.trim()}>+ Add Folder</button>
        </div>
      </div>
    )
    if (step === 4) {
      const targets = getTargets()
      return (
        <div className="wizard-body">
          <div className="wizard-field-label">Matrix Architect Targets</div>
          <div className="wizard-hint-sm">These targets will be created automatically.</div>
          <div className="wizard-target-list">
            {targets.map(t => (
              <div key={t.id} className="wizard-target-item">
                <div className="wizard-target-header">
                  <span className="target-badge">{t.isRoot ? 'ROOT' : t.class}</span>
                  <code className="wizard-target-path">{t.folderPath.split(/[/\\]/).filter(Boolean).pop()}/</code>
                </div>
                <div className="wizard-target-ignores">Ignores: <span className="wizard-ignore-list">{t.ignorePatterns.join(', ')}</span></div>
              </div>
            ))}
          </div>
        </div>
      )
    }
    const projectPath = destination ? pathJoin(destination, folderName) : null
    const kbPath = destination ? pathJoin(destination, knowledgeName) : null
    return (
      <div className="wizard-body">
        <div className="wizard-field-label">Where should the project be created?</div>
        <div className="wizard-dest-row">
          <code className="wizard-dest-path">{destination || 'No folder selected'}</code>
          <button className="wizard-browse-btn" onClick={async () => {
            const p = await window.api.selectFolder()
            if (p) { setDestination(p); setDestError(null) }
          }}>Browse</button>
        </div>
        {destination && (
          <div className="wizard-dest-preview">
            <div>→ <code>{projectPath}/</code></div>
            <div>→ <code>{kbPath}/</code></div>
          </div>
        )}
        {destError && <div className="wizard-error">{destError}</div>}
        {createError && <div className="wizard-error">Error: {createError}</div>}
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel wizard-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-label">Directory Builder</span>
            <span className="modal-domain-name">New Project</span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {renderStepIndicator()}
        {renderStep()}
        <div className="modal-footer">
          {step > 1 && <button className="modal-cancel-btn" onClick={goBack} disabled={creating}>← Back</button>}
          <button className="modal-done-btn" onClick={goNext} disabled={isNextDisabled}>
            {isLastStep ? (creating ? 'Creating...' : 'Create ▶') : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
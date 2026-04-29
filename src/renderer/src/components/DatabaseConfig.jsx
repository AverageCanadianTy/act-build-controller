import { useState } from 'react'
import SheetTracker from './SheetTracker'

export default function DatabaseConfig({ project, oauthStatus, onUpdate, onOAuthRequest }) {
  const [sqliteDbPath, setSqliteDbPath] = useState('')
  const [postgresConnStr, setPostgresConnStr] = useState('')
  const [sqliteStatus, setSqliteStatus] = useState(null)
  const [postgresStatus, setPostgresStatus] = useState(null)

  const sheetGroups = (project.dbTargets || [])
    .filter(t => t.type === 'sheets' || t.type === 'SHEETS')
    .map(t => ({ id: t.id, label: t.label, sheetIds: t.config?.sheetIds || [] }))

  const syntheticProject = {
    ...project,
    sheetTracker: { enabled: sheetGroups.length > 0 || !!oauthStatus?.hasToken, groups: sheetGroups }
  }

  const handleSheetTrackerUpdate = (updater) => {
    onUpdate(prev => {
      const currentGroups = (prev.dbTargets || [])
        .filter(t => t.type === 'sheets' || t.type === 'SHEETS')
        .map(t => ({ id: t.id, label: t.label, sheetIds: t.config?.sheetIds || [] }))
      const syntheticTracker = { enabled: true, groups: currentGroups }
      const patch = typeof updater === 'function' ? updater(syntheticTracker)
        : updater?.sheetTracker ? updater.sheetTracker : { ...syntheticTracker, ...updater }
      const nonSheet = (prev.dbTargets || []).filter(t => t.type !== 'sheets' && t.type !== 'SHEETS')
      const sheetTargets = (patch.groups || []).map(g => ({
        id: g.id, type: 'sheets', label: g.label, connectionInfo: '',
        lastExported: (prev.dbTargets || []).find(t => t.id === g.id)?.lastExported || null,
        config: { sheetIds: g.sheetIds || [] }
      }))
      return { ...prev, dbTargets: [...nonSheet, ...sheetTargets] }
    })
  }

  return (
    <div className="dbconfig-view">
      <h1>Database Configuration</h1>
      <div className="dbconfig-hint">Configure data sources. Each source generates a JSON matrix for LLM context and appears as a build target in Command Center.</div>

      <div className="dbconfig-section">
        <div className="dbconfig-section-header">
          <span className="dbconfig-section-badge">SHEETS</span>
          <span className="dbconfig-section-label">Google Sheets</span>
        </div>
        <SheetTracker
          project={syntheticProject}
          oauthStatus={oauthStatus}
          onUpdate={handleSheetTrackerUpdate}
          onOAuthRequest={onOAuthRequest}
        />
      </div>

      <div className="dbconfig-section">
        <div className="dbconfig-section-header">
          <span className="dbconfig-section-badge dbconfig-badge-sql">SQL</span>
          <span className="dbconfig-section-label">SQL Database</span>
        </div>

        <div className="dbconfig-sql-group">
          <div className="dbconfig-sql-label">SQLite</div>
          <div className="dbconfig-sql-row">
            <input
              className="dbconfig-sql-input"
              placeholder="Path to .db file…"
              value={sqliteDbPath}
              onChange={e => setSqliteDbPath(e.target.value)}
            />
            <button
              className="refresh-btn"
              disabled={!sqliteDbPath || !project.knowledgePath}
              onClick={async () => {
                setSqliteStatus('Generating…')
                const r = await window.api.generateSqliteSchema({
                  dbPath: sqliteDbPath, projectName: project.name, knowledgePath: project.knowledgePath
                })
                setSqliteStatus(r.success ? `✓ ${r.outputPath}` : `✗ ${r.error}`)
                if (r.success) onUpdate(prev => ({
                  ...prev,
                  dbTargets: [
                    ...(prev.dbTargets || []).filter(t => t.type !== 'sqlite'),
                    { id: `db_sqlite_${Date.now()}`, type: 'sqlite', label: 'SQLite', connectionInfo: sqliteDbPath, lastExported: new Date().toISOString() }
                  ]
                }))
              }}
            >Generate Schema JSON</button>
          </div>
          {sqliteStatus && <div className="dbconfig-sql-status">{sqliteStatus}</div>}
        </div>

        <div className="dbconfig-sql-group">
          <div className="dbconfig-sql-label">PostgreSQL</div>
          <div className="dbconfig-sql-row">
            <input
              className="dbconfig-sql-input"
              placeholder="postgresql://user:pass@host:5432/dbname"
              value={postgresConnStr}
              onChange={e => setPostgresConnStr(e.target.value)}
            />
            <button
              className="refresh-btn"
              disabled={!postgresConnStr || !project.knowledgePath}
              onClick={async () => {
                setPostgresStatus('Generating…')
                const r = await window.api.generatePostgresSchema({
                  connectionString: postgresConnStr, projectName: project.name, knowledgePath: project.knowledgePath
                })
                setPostgresStatus(r.success ? `✓ ${r.outputPath}` : `✗ ${r.error}`)
                if (r.success) onUpdate(prev => ({
                  ...prev,
                  dbTargets: [
                    ...(prev.dbTargets || []).filter(t => t.type !== 'postgres'),
                    { id: `db_postgres_${Date.now()}`, type: 'postgres', label: 'PostgreSQL', connectionInfo: postgresConnStr, lastExported: new Date().toISOString() }
                  ]
                }))
              }}
            >Generate Schema JSON</button>
          </div>
          {postgresStatus && <div className="dbconfig-sql-status">{postgresStatus}</div>}
        </div>
      </div>
    </div>
  )
}
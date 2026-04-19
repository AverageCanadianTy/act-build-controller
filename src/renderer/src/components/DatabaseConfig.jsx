import SheetTracker from './SheetTracker'

export default function DatabaseConfig({ project, oauthStatus, onUpdate, onOAuthRequest }) {
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
          project={project}
          oauthStatus={oauthStatus}
          onUpdate={onUpdate}
          onOAuthRequest={onOAuthRequest}
        />
      </div>

      <div className="dbconfig-section dbconfig-section-muted">
        <div className="dbconfig-section-header">
          <span className="dbconfig-section-badge dbconfig-badge-sql">SQL</span>
          <span className="dbconfig-section-label">SQL Database</span>
          <span className="dbconfig-coming-soon">Coming in a future update</span>
        </div>
      </div>
    </div>
  )
}
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    const component = this.props.name || 'Unknown'
    if (window.api?.logError) {
      window.api.logError({
        component,
        message: error?.message || String(error),
        stack: (error?.stack || '') + '\n\nComponent Stack:\n' + (info?.componentStack || '')
      }).then(({ logPath }) => {
        console.error(`[ErrorBoundary] Error logged to: ${logPath}`)
      })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, color: '#fc8181' }}>
          <strong>Component error — check act-error.log in userData for full details.</strong>
          <pre style={{ fontSize: '0.72rem', marginTop: 12, color: '#4a5568', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
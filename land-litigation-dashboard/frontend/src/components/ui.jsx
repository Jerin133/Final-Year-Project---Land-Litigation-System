export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

export function Card({ title, right, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <h3>{title}</h3>
          <div>{right}</div>
        </div>
      )}
      {children}
    </section>
  )
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

export function ErrorBox({ error }) {
  if (!error) return null
  return <div className="alert alert-error">{error.message || String(error)}</div>
}

export function Badge({ children, tone = 'gray' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export const statusTone = (s) => (s === 'Disposed' ? 'green' : s === 'Appeal Pending' ? 'orange' : 'blue')
export const bandTone = (b) => (b === 'High' ? 'red' : b === 'Medium' ? 'orange' : b === 'Low' ? 'green' : 'gray')

import { Navigate } from 'react-router-dom'
import { useAuth, homeFor } from '../lib/auth.jsx'

export default function ProtectedRoute({ role, children }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="page-loading">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role !== role) return <Navigate to={homeFor(profile.role)} replace />
  return children
}

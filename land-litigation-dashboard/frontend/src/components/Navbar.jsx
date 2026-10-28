import { Link, useNavigate } from 'react-router-dom'
import { useAuth, homeFor } from '../lib/auth.jsx'
import {
  LayoutDashboard,
  LogOut,
  LogIn,
  UserPlus,
  ShieldCheck,
  Landmark,
  User
} from 'lucide-react'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function logout() {
    await signOut()
    navigate('/')
  }

  const roleLabel = profile?.role === 'admin'
    ? 'Administrator'
    : profile?.role === 'government'
      ? 'Government'
      : 'Citizen'

  const RoleIcon = profile?.role === 'admin'
    ? ShieldCheck
    : profile?.role === 'government'
      ? Landmark
      : User

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <img src="/unigaia-logo.png" alt="UniGaia Logo" className="brand-logo" />
        <span className="brand-text">
          <strong className="brand-name">UniGaia</strong>
          <small className="brand-sub">Land Litigation Intelligence</small>
        </span>
      </Link>

      <nav className="navbar-nav">
        <Link to="/" className="nav-link-home">Home</Link>
        {profile ? (
          <>
            <Link to={homeFor(profile.role)} className="nav-dashboard-link">
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <LayoutDashboard size={14} />
                <span className="btn-label">{profile.role === 'admin' ? 'Admin Console' : 'Dashboard'}</span>
              </span>
            </Link>
            <span className={`role-pill ${profile.role}`}>
              <RoleIcon size={11} />
              <span className="role-label">{roleLabel}</span>
            </span>
            <button className="btn btn-outline nav-logout-btn" onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <LogOut size={13} />
              <span className="btn-label">Sign out</span>
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-outline nav-auth-btn">
              <LogIn size={13} />
              <span>Sign in</span>
            </Link>
            <Link to="/register" className="btn btn-primary nav-auth-btn">
              <UserPlus size={13} />
              <span>Register</span>
            </Link>
          </>
        )}
      </nav>
    </header>
  )
}

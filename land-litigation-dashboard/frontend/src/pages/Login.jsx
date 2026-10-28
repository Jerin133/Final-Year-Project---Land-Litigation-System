import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, homeFor } from '../lib/auth.jsx'
import { LogIn, Shield } from 'lucide-react'

export default function Login() {
  const { signIn, signOut, session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // One login page for everyone: role decides where you land (citizen, government, or admin)
  useEffect(() => {
    if (profile) navigate(homeFor(profile.role), { replace: true })
  }, [profile, navigate])

  useEffect(() => {
    if (submitted && !loading && session && !profile) {
      setError('Your account has no profile. Ask the administrator to check the setup.')
      setSubmitted(false)
      setBusy(false)
      signOut()
    }
  }, [submitted, loading, session, profile, signOut])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email, password)
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Login failed')
      setBusy(false)
    }
  }

  return (
    <div className="center-card">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <img src="/unigaia-logo.png" alt="UniGaia" style={{ width: '56px', height: '56px', objectFit: 'contain' }} />
          <h2 style={{ marginTop: '8px', fontSize: '22px' }}>Sign in to UniGaia</h2>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', fontWeight: 700 }}>
            Land Litigation Intelligence Platform
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <label>
          Email Address
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. citizen@gmail.com, official@gov.in"
            autoComplete="username"
          />
        </label>

        <label>
          Password
          <input
            id="login-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>

        <div style={{ marginTop: '20px' }}>
          <button id="login-submit" className="btn btn-primary btn-block" disabled={busy}>
            <LogIn size={15} />
            {busy ? 'Authenticating…' : 'Sign in'}
          </button>
        </div>

        <p className="muted center small" style={{ marginTop: '20px' }}>
          New citizen? <Link to="/register" style={{ fontWeight: 600 }}>Create an account</Link>
        </p>
      </form>
    </div>
  )
}

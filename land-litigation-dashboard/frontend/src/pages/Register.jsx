import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, homeFor } from '../lib/auth.jsx'
import { UserPlus } from 'lucide-react'

export default function Register() {
  const { signUp, profile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (profile) navigate(homeFor(profile.role), { replace: true })
  }, [profile, navigate])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const { needsConfirmation } = await signUp(form.name, form.email, form.password)
      setInfo(needsConfirmation
        ? 'Account created. Check your Gmail inbox and click the confirmation link, then sign in.'
        : 'Account created. Redirecting…')
    } catch (err) {
      setError(err.message || 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-card">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <img src="/unigaia-logo.png" alt="UniGaia" style={{ width: '56px', height: '56px', objectFit: 'contain' }} />
          <h2 style={{ marginTop: '8px', fontSize: '22px' }}>Citizen Registration</h2>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', fontWeight: 700 }}>
            UniGaia · Land Litigation Intelligence
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {info && <div className="alert alert-ok">{info}</div>}

        <label>
          Full Name
          <input required value={form.name} onChange={set('name')} placeholder="e.g. Anand Kumar" />
        </label>

        <label>
          Gmail Address
          <input type="email" required value={form.email} onChange={set('email')} placeholder="name@gmail.com" />
        </label>

        <label>
          Password (at least 8 characters)
          <input type="password" required value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="••••••••" />
        </label>

        <label>
          Confirm Password
          <input type="password" required value={form.confirm} onChange={set('confirm')} autoComplete="new-password" placeholder="••••••••" />
        </label>

        <div style={{ marginTop: '20px' }}>
          <button className="btn btn-primary btn-block" disabled={busy}>
            <UserPlus size={15} />
            {busy ? 'Creating account…' : 'Create Citizen Account'}
          </button>
        </div>

        <p className="muted center small" style={{ marginTop: '20px' }}>
          Already registered? <Link to="/login" style={{ fontWeight: 600 }}>Sign in here</Link>
        </p>
      </form>
    </div>
  )
}

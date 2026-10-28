import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase.js'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export const CITIZEN_DOMAIN = '@gmail.com'
export const GOV_DOMAIN = '@gov.in'
export const homeFor = (role) => (role === 'admin' ? '/admin' : role === 'government' ? '/government' : '/citizen')

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => {
    if (!supabase || !userId) return
    let cancelled = false
    setLoading(true)

    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled) {
          if (error) {
            console.error('Error fetching user profile:', error)
          }
          setProfile(data || null)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [userId])

  async function signIn(email, password) {
    const e = email.trim().toLowerCase()
    setLoading(true)

    if (!supabase) {
      setLoading(false)
      throw new Error('Authentication service is not configured.')
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: e, password })
    if (error) {
      setLoading(false)
      throw error
    }

    if (data.session?.user) {
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.session.user.id)
        .maybeSingle()

      if (profErr) {
        console.error('Error fetching profile on login:', profErr)
      }
      setProfile(prof || null)
    }

    setLoading(false)
    return data.session?.user
  }

  async function signUp(fullName, email, password) {
    const e = email.trim().toLowerCase()
    if (!e.endsWith(CITIZEN_DOMAIN)) {
      throw new Error(`Registration is for citizens with a ${CITIZEN_DOMAIN} address. Government and Administrator accounts are issued directly in the database.`)
    }
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error } = await supabase.auth.signUp({
      email: e,
      password,
      options: { data: { full_name: fullName.trim() } },
    })
    if (error) throw error
    return { needsConfirmation: !data.session }
  }

  async function signOut() {
    if (supabase) {
      try { await supabase.auth.signOut() } catch { /* ignore */ }
    }
    setSession(null)
    setProfile(null)
  }

  return (
    <AuthCtx.Provider value={{ session, user: session?.user, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { caseApi, landApi } from '../lib/api.js'
import { useAuth, homeFor } from '../lib/auth.jsx'
import {
  Map,
  FileText,
  BarChart2,
  Users,
  Landmark,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Search,
  Scale,
  Sparkles,
} from 'lucide-react'

export default function Home() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ cases: null, villages: null, surveys: null })

  useEffect(() => {
    let cancelled = false
    let retryTimer = null

    const fetchStats = async (attempt = 1) => {
      try {
        const [c, v] = await Promise.allSettled([caseApi.search({}), landApi.villages()])
        if (cancelled) return

        const casesVal = c.status === 'fulfilled' ? c.value?.count : null
        const villagesVal = v.status === 'fulfilled' ? v.value?.villages?.length : null
        const surveysVal = v.status === 'fulfilled' ? v.value?.villages?.reduce((a, x) => a + (x.survey_count || 0), 0) : null

        setStats((prev) => ({
          cases: casesVal ?? prev.cases,
          villages: villagesVal ?? prev.villages,
          surveys: surveysVal ?? prev.surveys,
        }))

        // If either API didn't succeed (e.g. Render backend is waking up), retry up to 4 times
        if ((casesVal == null || villagesVal == null) && attempt < 5) {
          retryTimer = setTimeout(() => {
            if (!cancelled) fetchStats(attempt + 1)
          }, 3500)
        }
      } catch {
        if (!cancelled && attempt < 5) {
          retryTimer = setTimeout(() => {
            if (!cancelled) fetchStats(attempt + 1)
          }, 3500)
        }
      }
    }

    fetchStats()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [])

  const show = (n) => (n == null ? '—' : n.toLocaleString('en-IN'))

  return (
    <main>
      {/* ---- Modern Cinematic Hero ---- */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-grid">
            {/* Left Content */}
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                <span>Government of Tamil Nadu · Land &amp; Judicial Administration</span>
              </div>
              <h1>
                Know the legal status of any land parcel —{' '}
                <span className="gradient-text">instantly, by survey number.</span>
              </h1>
              <p className="lead">
                UniGaia integrates official revenue records (Chitta &amp; A-Register) with court-case
                records extracted from English and Tamil legal judgments. Citizens check land disputes
                and officials prioritize enforcement hotspots with automated risk models.
              </p>
              <div className="hero-actions">
                {profile ? (
                  <Link to={homeFor(profile.role)} className="btn btn-primary btn-lg">
                    Open My Dashboard <ArrowRight size={17} />
                  </Link>
                ) : (
                  <>
                    <Link to="/register" className="btn btn-accent btn-lg">
                      Citizen Registration <ArrowRight size={17} />
                    </Link>
                    <Link to="/login" className="btn btn-light btn-lg">
                      Sign In to Console
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Right Live Intelligence Snapshot Glass Card */}
            <div>
              <div className="hero-glass-card">
                <div className="glass-header">
                  <span className="glass-tag">
                    <ShieldCheck size={14} />
                    Live System Intelligence
                  </span>
                  <span className="glass-status">
                    <span className="dot on" />
                    Tamil Nadu Registry Active
                  </span>
                </div>

                <div className="glass-item">
                  <div className="glass-item-label">Integrated Registry Index</div>
                  <div className="glass-item-val" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Chitta &amp; A-Register Correlated</span>
                    <span className="badge badge-teal small">Cross-Verified</span>
                  </div>
                </div>

                <div className="glass-item">
                  <div className="glass-item-label">Bilingual AI Legal Extraction</div>
                  <div className="glass-item-val" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>English &amp; தமிழ் Court Cases</span>
                    <span className="badge badge-blue small">Full NLP Extraction</span>
                  </div>
                </div>

                <div className="glass-item">
                  <div className="glass-item-label">Risk Modeling &amp; Projections</div>
                  <div className="glass-item-val" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Disposal Duration &amp; Appeal Risk</span>
                    <span className="badge badge-green small">Live Predictive AI</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Stats Strip ---- */}
      <div className="strip">
        <div className="strip-item">
          <span className="strip-num">{show(stats.cases)}</span>
          <span className="strip-label">Court Cases Indexed</span>
        </div>
        <div className="strip-item">
          <span className="strip-num">{show(stats.villages)}</span>
          <span className="strip-label">Revenue Villages Covered</span>
        </div>
        <div className="strip-item">
          <span className="strip-num">{show(stats.surveys)}</span>
          <span className="strip-label">Survey Numbers on Record</span>
        </div>
        <div className="strip-item">
          <span className="strip-num">2</span>
          <span className="strip-label">Languages — English &amp; தமிழ்</span>
        </div>
      </div>

      {/* ---- How it Works ---- */}
      <section className="section">
        <h2>How the System Works</h2>
        <div className="grid-3">
          <div className="feature-card">
            <div className="feature-icon">
              <Map />
            </div>
            <h3>1 · Land Records Registry</h3>
            <p>
              Ownership, patta particulars, total extent, and land classification are parsed from
              official Chitta and A-Register records for each revenue village.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <FileText />
            </div>
            <h3>2 · Court Case Intelligence</h3>
            <p>
              Case details — parties, dispute type, status, hearings, and adjournments — are extracted
              directly from judgment and petition PDFs in English and Tamil.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <BarChart2 />
            </div>
            <h3>3 · Risk &amp; Predictive Analytics</h3>
            <p>
              Statistical machine learning models estimate remaining duration, disposal projections,
              and likelihood of appeal so delays can be anticipated accurately.
            </p>
          </div>
        </div>
      </section>

      {/* ---- For Citizens & Officials ---- */}
      <section className="section alt">
        <div className="two-col">
          <div>
            <h2>
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Users size={24} style={{ color: 'var(--accent)' }} />
                For Citizens
              </span>
            </h2>
            <ul className="ticks">
              <li>Instant search by Survey Number or Patta Number with full land details</li>
              <li>Every linked court case and dispute history surfaced in one view</li>
              <li>Download comprehensive Land &amp; Litigation Reports and case documents</li>
              <li>Track active cases and receive instant notifications on hearing dates</li>
              <li>Bilingual AI summaries in English and தமிழ் for legal documents</li>
            </ul>
          </div>

          <div>
            <h2>
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Landmark size={24} style={{ color: 'var(--primary-light)' }} />
                For Government Officials
              </span>
            </h2>
            <ul className="ticks">
              <li>Litigation hotspots automatically ranked across survey numbers</li>
              <li>Identification of frequently disputed revenue villages</li>
              <li>Monthly filing and disposal trend analytics with PDF/CSV export</li>
              <li>Automated cross-check for encroachment on government and Poramboke land</li>
              <li>Pending case portfolio analytics with risk scoring and disposal timelines</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="footer">
        <p>Case records shown are <b>synthetic demonstration data</b> and are not official court records.</p>
        <p>UniGaia — Land Litigation Intelligence System.</p>
      </footer>
    </main>
  )
}

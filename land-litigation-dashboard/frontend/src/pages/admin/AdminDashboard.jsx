import { useState, useEffect } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { landApi, caseApi, gisApi } from '../../lib/api.js'
import { Map, Scale, Layers } from 'lucide-react'
import LandRecordUpload from './LandRecordUpload.jsx'
import CourtCaseUpload from './CourtCaseUpload.jsx'
import GisRecordUpload from './GisRecordUpload.jsx'

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('land') // 'land' | 'cases' | 'gis'

  const [overview, setOverview] = useState({
    villagesCount: 0,
    surveysCount: 0,
    casesCount: 0,
    gisVillagesCount: 0,
  })

  useEffect(() => {
    refreshOverview()
  }, [])

  async function refreshOverview() {
    try {
      const [vRes, cRes, gRes] = await Promise.allSettled([
        landApi.villages(),
        caseApi.search({}),
        gisApi.villages(),
      ])

      const villages = vRes.status === 'fulfilled' ? vRes.value.villages || [] : []
      const casesCount = cRes.status === 'fulfilled' ? cRes.value.count || 0 : 0
      const surveysCount = villages.reduce((acc, v) => acc + (v.survey_count || 0), 0)
      const gisVillages = gRes.status === 'fulfilled' ? gRes.value || [] : []

      setOverview({
        villagesCount: villages.length,
        surveysCount,
        casesCount,
        gisVillagesCount: gisVillages.length,
      })
    } catch (err) {
      console.error('Failed to refresh admin overview', err)
    }
  }

  return (
    <main className="admin-shell">
      {/* Top Admin Banner */}
      <section className="admin-banner">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span className="role-pill admin">ADMINISTRATOR CONSOLE</span>
            <span style={{ fontSize: '13px', color: '#38bdf8' }}>Tamil Nadu Land Administration</span>
          </div>
          <h1>System Data &amp; Integration Hub</h1>
          <p>
            Welcome, <strong>{profile?.full_name || 'Administrator'}</strong> ({profile?.email}).
            Upload and synchronize village land records, court case documents, and manage live cadastral GIS intelligence.
          </p>
        </div>

        <div className="admin-stats-row">
          <div className="admin-stat-chip">
            <strong>{overview.villagesCount}</strong>
            <span>Villages</span>
          </div>
          <div className="admin-stat-chip">
            <strong>{overview.surveysCount.toLocaleString('en-IN')}</strong>
            <span>Surveys</span>
          </div>
          <div className="admin-stat-chip">
            <strong>{overview.casesCount}</strong>
            <span>Indexed Cases</span>
          </div>
          <div className="admin-stat-chip">
            <strong>{overview.gisVillagesCount}</strong>
            <span>GIS Maps</span>
          </div>
        </div>
      </section>

      {/* Navigation Tabs */}
      <nav className="admin-nav">
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'land' ? 'active' : ''}`}
          onClick={() => setActiveTab('land')}
        >
          <Map size={16} />
          <span>Land Records Registry</span>
        </button>

        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'cases' ? 'active' : ''}`}
          onClick={() => setActiveTab('cases')}
        >
          <Scale size={16} />
          <span>Court Case Intelligence</span>
        </button>

        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'gis' ? 'active' : ''}`}
          onClick={() => setActiveTab('gis')}
        >
          <Layers size={16} />
          <span>GIS Boundary Integration</span>
        </button>
      </nav>

      {/* Registry, Case Intelligence, and GIS sections */}
      {activeTab === 'land' && (
        <LandRecordUpload onVillageUpdated={refreshOverview} />
      )}

      {activeTab === 'cases' && (
        <CourtCaseUpload onCasesUpdated={refreshOverview} />
      )}

      {activeTab === 'gis' && (
        <GisRecordUpload onGisUpdated={refreshOverview} />
      )}
    </main>
  )
}

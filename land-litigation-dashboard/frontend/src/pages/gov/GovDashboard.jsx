import { useState } from 'react'
import { useAuth } from '../../lib/auth.jsx'
import { useGovData } from './useGovData.js'
import { ErrorBox } from '../../components/ui.jsx'
import Overview from './Overview.jsx'
import Hotspots from './Hotspots.jsx'
import Villages from './Villages.jsx'
import Monthly from './Monthly.jsx'
import Encroachment from './Encroachment.jsx'
import Pending from './Pending.jsx'
import GovCadastralMap from './GovCadastralMap.jsx'
import { LayoutDashboard, Flame, MapPin, CalendarDays, AlertTriangle, Clock, RefreshCw, Layers } from 'lucide-react'

const TABS = [
  ['overview',      'Overview',            LayoutDashboard],
  ['hotspots',      'Litigation Hotspots', Flame],
  ['cadastral',     'Cadastral GIS Map',   Layers],
  ['villages',      'Disputed Villages',   MapPin],
  ['monthly',       'Monthly Reports',     CalendarDays],
  ['encroachment',  'Encroachment',        AlertTriangle],
  ['pending',       'Pending Analytics',   Clock],
]

export default function GovDashboard() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('overview')
  const d = useGovData()

  return (
    <div className="dash wide">
      <div className="dash-head">
        <div>
          <h1>Decision Support Dashboard</h1>
          <p className="muted">{profile?.full_name || profile?.email} &nbsp;·&nbsp; Live from case-retrieval, land-record, and GIS spatial services</p>
        </div>
        <div className="live">
          <span className={`dot ${d.error ? 'off' : 'on'}`} />
          {d.error ? 'Offline' : 'Live'} &nbsp;·&nbsp; {d.updated ? `Updated ${d.updated.toLocaleTimeString('en-IN')}` : 'Loading…'}
          <button className="btn btn-outline btn-sm" onClick={d.reload} disabled={d.loading}>
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <ErrorBox error={d.error} />
      {d.loading && !d.cases.length && <div className="page-loading">Loading data</div>}
      {d.cases.length > 0 && (
        <>
          {tab === 'overview'     && <Overview        cases={d.cases} />}
          {tab === 'hotspots'     && <Hotspots        cases={d.cases} />}
          {tab === 'cadastral'    && <GovCadastralMap cases={d.cases} />}
          {tab === 'villages'     && <Villages        cases={d.cases} villages={d.villages} landOffline={d.landOffline} />}
          {tab === 'monthly'      && <Monthly         cases={d.cases} />}
          {tab === 'encroachment' && <Encroachment    cases={d.cases} landOffline={d.landOffline} />}
          {tab === 'pending'      && <Pending         cases={d.cases} riskOffline={d.riskOffline} />}
        </>
      )}
    </div>
  )
}

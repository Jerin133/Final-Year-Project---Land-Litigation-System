import { useMemo, useState, useEffect } from 'react'
import { Card, Badge, bandTone } from '../../components/ui.jsx'
import { BarBox } from './charts.jsx'
import { downloadCsv } from '../../lib/util.js'
import { gisApi } from '../../lib/api.js'
import GisMap from '../../components/GisMap.jsx'
import { Map as MapIcon, Grid, Layers, RefreshCw } from 'lucide-react'

const RANK = { High: 3, Medium: 2, Low: 1 }

export function groupBySurvey(cases = []) {
  const m = new Map()
    ; (cases || []).forEach((c) => {
      const key = `${c.village}|${c.survey_no}`
      if (!m.has(key)) m.set(key, { key, village: c.village, survey: c.survey_no, total: 0, open: 0, types: new Set(), scores: [], band: null, landClass: c.landClass })
      const g = m.get(key)
      g.total += 1
      if (c.open) g.open += 1
      if (c.dispute_type?.english) g.types.add(c.dispute_type.english)
      if (c.risk?.risk_score != null) g.scores.push(c.risk.risk_score)
      const b = c.risk?.risk_band
      if (RANK[b] && (!g.band || RANK[b] > RANK[g.band])) g.band = b
    })
  return [...m.values()].map((g) => ({ ...g, avgRisk: g.scores.length ? g.scores.reduce((a, b) => a + b, 0) / g.scores.length : null }))
}

const level = (n) => (n >= 4 ? 4 : n)

export default function Hotspots({ cases }) {
  const [minCases, setMinCases] = useState(1)
  const [openOnly, setOpenOnly] = useState(false)
  const [viewMode, setViewMode] = useState('map') // 'map' | 'grid'

  // GIS Data State
  const [gisVillages, setGisVillages] = useState([])
  const [selectedVillageSlug, setSelectedVillageSlug] = useState('')
  const [geoJsonData, setGeoJsonData] = useState(null)
  const [loadingGis, setLoadingGis] = useState(false)

  const rows = useMemo(() => {
    const base = openOnly ? cases.filter((c) => c.open) : cases
    return groupBySurvey(base).sort((a, b) => b.total - a.total || (b.avgRisk ?? 0) - (a.avgRisk ?? 0))
  }, [cases, openOnly])

  const shown = rows.filter((r) => r.total >= minCases)
  const top = shown.slice(0, 12).map((r) => ({ name: `Sy.${r.survey}`, Open: r.open, Closed: r.total - r.open }))
  const grid = [...shown].sort((a, b) => Number(a.survey) - Number(b.survey) || String(a.survey).localeCompare(String(b.survey)))
  const repeat = rows.filter((r) => r.total >= 2).length

  // Map of survey_no -> dispute info for GIS color-coding
  const casesBySurvey = useMemo(() => {
    const map = {}
    shown.forEach((r) => {
      const sNo = String(r.survey).trim()
      map[sNo] = { total: r.total, open: r.open, band: r.band }
    })
    return map
  }, [shown])

  // Load GIS villages
  useEffect(() => {
    loadGisVillages()
  }, [])

  async function loadGisVillages() {
    try {
      const list = await gisApi.villages()
      setGisVillages(list || [])
      // Keep empty so user selects which village map to inspect
    } catch (err) {
      console.warn('GIS server not available on port 8002:', err)
      setViewMode('grid')
    }
  }

  async function loadPolygons(slug) {
    if (!slug) {
      setGeoJsonData(null)
      return
    }
    setLoadingGis(true)
    try {
      const geo = await gisApi.polygons(slug)
      setGeoJsonData(geo)
    } catch (err) {
      console.warn('Failed to load polygons for', slug, err)
    } finally {
      setLoadingGis(false)
    }
  }

  function handleVillageChange(slug) {
    setSelectedVillageSlug(slug)
    loadPolygons(slug)
  }

  return (
    <>
      <Card title="Hotspot filters">
        <div className="filters">
          <label>Minimum cases per survey number
            <select value={minCases} onChange={(e) => setMinCases(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Count open cases only</label>
          <span className="muted">{rows.length} survey numbers have litigation · {repeat} have repeat disputes</span>
        </div>
      </Card>

      <Card title="Top litigation hotspots (cases per survey number)">
        <BarBox data={top} xKey="name" bars={[{ key: 'Open', color: '#e07b00' }, { key: 'Closed', color: '#2a9d8f' }]} stacked horizontal height={Math.max(220, top.length * 30)} />
      </Card>

      {/* Interactive Cadastral Map & Heat Grid View */}
      <Card
        title="Cadastral GIS Hotspot Map"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {gisVillages.length > 0 && (
              <select
                value={selectedVillageSlug}
                onChange={(e) => handleVillageChange(e.target.value)}
                style={{ margin: 0, fontSize: '13px', padding: '6px 10px', height: '36px', minWidth: '200px', width: 'auto' }}
              >
                <option value="">-- Select Village Map ({gisVillages.length}) --</option>
                {gisVillages.map((v) => (
                  <option key={v.slug} value={v.slug}>{v.name}</option>
                ))}
              </select>
            )}
            <div className="seg" style={{ fontSize: '12px' }}>
              <button
                type="button"
                className={viewMode === 'map' ? 'on' : ''}
                onClick={() => setViewMode('map')}
                style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <MapIcon size={13} />
                Map
              </button>
              <button
                type="button"
                className={viewMode === 'grid' ? 'on' : ''}
                onClick={() => setViewMode('grid')}
                style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Grid size={13} />
                Grid
              </button>
            </div>
          </div>
        }
      >
        {viewMode === 'map' ? (
          !selectedVillageSlug ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 600, color: 'var(--navy)', fontSize: '14px' }}>
                Please select a village from the dropdown above
              </p>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                Select any available village above to load its cadastral boundaries, or switch to Grid mode to see all survey dispute counts.
              </p>
            </div>
          ) : loadingGis ? (
            <div style={{ height: '440px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
              Loading spatial boundaries…
            </div>
          ) : geoJsonData ? (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px', fontSize: '12px', color: '#475569' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#dc2626', display: 'inline-block' }} />
                    <strong>High (3+ Cases)</strong>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#ea580c', display: 'inline-block' }} />
                    <strong>Medium (1-2 Cases)</strong>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#0d9488', display: 'inline-block' }} />
                    <span>Clear (0 Cases)</span>
                  </span>
                </div>
                <span className="muted small">
                  {geoJsonData.features?.length || 0} digitized survey parcels · Click any parcel for details
                </span>
              </div>

              <GisMap
                featureCollection={geoJsonData}
                casesBySurvey={casesBySurvey}
                height="440px"
                showLabels={true}
              />
            </div>
          ) : (
            <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
              No cadastral polygons found for the selected village.
            </div>
          )
        ) : (
          <div>
            <div className="heat">
              {grid.map((r) => (
                <div key={r.key} className={`heat-tile lv${level(r.total)}`} title={`Survey ${r.survey}: ${r.total} case(s), ${r.open} open · ${[...r.types].join(', ')}`}>
                  <b>{r.survey}</b><span>{r.total}</span>
                </div>
              ))}
            </div>
            {geoJsonData ? (
              <p className="muted small" style={{ marginTop: '10px' }}>
                Showing survey heat grid. Switch to &quot;Map&quot; mode above to view spatial cadastral parcel boundaries.
              </p>
            ) : (
              <p className="muted small" style={{ marginTop: '10px' }}>
                Showing survey litigation heat grid. Choose a village above and switch to Map mode to view spatial boundaries.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card title="Hotspot ranking" right={
        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv('litigation_hotspots.csv', [
          ['Village', 'Survey', 'Cases', 'Open', 'Dispute types', 'Avg risk', 'Highest band', 'Land class'],
          ...shown.map((r) => [r.village, r.survey, r.total, r.open, [...r.types].join('; '), r.avgRisk?.toFixed(1) ?? '', r.band ?? '', r.landClass]),
        ])}>⬇ CSV</button>}>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Village</th><th>Survey</th><th>Cases</th><th>Open</th><th>Dispute types</th><th>Avg risk</th><th>Land class</th></tr></thead>
          <tbody>{shown.slice(0, 30).map((r, i) => (
            <tr key={r.key}><td>{i + 1}</td><td>{r.village}</td><td><b>{r.survey}</b></td><td>{r.total}</td><td>{r.open}</td>
              <td>{[...r.types].join(', ')}</td>
              <td>{r.avgRisk != null ? <Badge tone={bandTone(r.band)}>{r.avgRisk.toFixed(0)}</Badge> : '—'}</td>
              <td>{r.landClass}</td></tr>
          ))}</tbody>
        </table></div>
        {shown.length > 30 && <p className="muted small">Showing top 30 of {shown.length}. Download the CSV for the full list.</p>}
      </Card>
    </>
  )
}


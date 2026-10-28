import { useState, useEffect, useMemo } from 'react'
import { Card, Badge, bandTone } from '../../components/ui.jsx'
import { gisApi } from '../../lib/api.js'
import GisMap from '../../components/GisMap.jsx'
import { groupBySurvey } from './Hotspots.jsx'
import {
  Layers,
  Search,
  MapPin,
  RefreshCw,
  AlertTriangle,
  Info,
  ArrowRight,
  Compass
} from 'lucide-react'

export default function GovCadastralMap({ cases = [] }) {
  const [villages, setVillages] = useState([])
  const [selectedVillageSlug, setSelectedVillageSlug] = useState('')
  const [geoJsonData, setGeoJsonData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'litigated' | 'high'
  const [searchSurvey, setSearchSurvey] = useState('')
  const [selectedParcel, setSelectedParcel] = useState(null)

  // Map of survey_no -> dispute info
  const litigationBySurvey = useMemo(() => {
    const grouped = groupBySurvey(cases || [])
    const map = {}
    grouped.forEach((g) => {
      map[String(g.survey).trim()] = g
    })
    return map
  }, [cases])

  useEffect(() => {
    loadVillages()
  }, [])

  async function loadVillages() {
    setLoading(true)
    try {
      const list = await gisApi.villages()
      setVillages(list || [])
      // User requested NOT to auto-select any default village.
      // We keep selectedVillageSlug empty so the user can choose which village to view.
    } catch (err) {
      console.warn('Failed to load GIS villages', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadPolygons(slug) {
    if (!slug) {
      setGeoJsonData(null)
      setSelectedParcel(null)
      return
    }
    setLoading(true)
    try {
      const geo = await gisApi.polygons(slug)
      setGeoJsonData(geo)
      setSelectedParcel(null)
    } catch (err) {
      console.warn('Failed to load polygons for', slug, err)
    } finally {
      setLoading(false)
    }
  }

  function handleVillageChange(slug) {
    setSelectedVillageSlug(slug)
    loadPolygons(slug)
  }

  // Filter features according to filterMode & searchSurvey
  const filteredGeoJson = useMemo(() => {
    if (!geoJsonData || !geoJsonData.features) return null

    let features = geoJsonData.features

    if (filterMode === 'litigated') {
      features = features.filter((f) => {
        const sNo = String(f.properties?.survey_no || '').trim()
        return Boolean(litigationBySurvey[sNo])
      })
    } else if (filterMode === 'high') {
      features = features.filter((f) => {
        const sNo = String(f.properties?.survey_no || '').trim()
        const dispute = litigationBySurvey[sNo]
        return dispute && (dispute.total >= 3 || dispute.band === 'High')
      })
    }

    if (searchSurvey.trim()) {
      features = features.filter((f) => {
        const sNo = String(f.properties?.survey_no || '').trim()
        return sNo.toLowerCase().includes(searchSurvey.trim().toLowerCase())
      })
    }

    return {
      ...geoJsonData,
      features,
    }
  }, [geoJsonData, filterMode, searchSurvey, litigationBySurvey])

  function handleSelectSurvey(surveyNo, props) {
    const dispute = litigationBySurvey[String(surveyNo).trim()] || null
    setSelectedParcel({ surveyNo, props, dispute })
  }

  const selectedVillageObj = villages.find((v) => v.slug === selectedVillageSlug)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Controls Bar */}
      <Card title="Cadastral Spatial Intelligence System">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          {/* Village Selector & Filter */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <MapPin size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                Select Village:
              </span>
              <select
                value={selectedVillageSlug}
                onChange={(e) => handleVillageChange(e.target.value)}
                disabled={loading || villages.length === 0}
                style={{
                  margin: 0,
                  height: '38px',
                  minWidth: '220px',
                  width: 'auto',
                  fontWeight: selectedVillageSlug ? 600 : 400,
                  padding: '6px 12px',
                  fontSize: '13.5px',
                  color: 'var(--text)'
                }}
              >
                <option value="">-- Choose a Village ({villages.length} available) --</option>
                {villages.map((v) => (
                  <option key={v.slug} value={v.slug}>{v.name}</option>
                ))}
              </select>
            </div>

            {selectedVillageSlug && (
              <div className="seg" style={{ fontSize: '12.5px', margin: 0 }}>
                <button
                  type="button"
                  className={filterMode === 'all' ? 'on' : ''}
                  onClick={() => setFilterMode('all')}
                  style={{ padding: '6px 12px' }}
                >
                  All Parcels ({geoJsonData?.features?.length || 0})
                </button>
                <button
                  type="button"
                  className={filterMode === 'litigated' ? 'on' : ''}
                  onClick={() => setFilterMode('litigated')}
                  style={{ padding: '6px 12px' }}
                >
                  Litigated Parcels
                </button>
                <button
                  type="button"
                  className={filterMode === 'high' ? 'on' : ''}
                  onClick={() => setFilterMode('high')}
                  style={{ padding: '6px 12px' }}
                >
                  High Risk
                </button>
              </div>
            )}
          </div>

          {/* Quick Survey Jump & Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {selectedVillageSlug && (
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', color: '#64748b', pointerEvents: 'none' }} />
                <input
                  type="text"
                  placeholder="Filter survey no..."
                  value={searchSurvey}
                  onChange={(e) => setSearchSurvey(e.target.value)}
                  style={{ margin: 0, height: '38px', paddingLeft: '32px', width: '165px', fontSize: '13px' }}
                />
              </div>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                loadVillages()
                if (selectedVillageSlug) loadPolygons(selectedVillageSlug)
              }}
              disabled={loading}
              title="Refresh GIS layer"
              style={{ height: '38px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </Card>

      {/* When NO Village is selected: show Village Directory */}
      {!selectedVillageSlug ? (
        <Card title="Available Cadastral Village Maps">
          <p className="muted" style={{ margin: '0 0 18px', fontSize: '14px' }}>
            Please select a village from the list below to view its digitized cadastral parcel boundaries, geometric extent, and litigation intensity:
          </p>

          {loading ? (
            <div style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
              Loading available village maps…
            </div>
          ) : villages.length === 0 ? (
            <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <Compass size={32} style={{ color: '#94a3b8', margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontWeight: 600 }}>No GIS Village Maps Registered</p>
              <p style={{ fontSize: '13px', margin: '4px 0 0', color: '#94a3b8' }}>
                Cadastral boundaries can be uploaded by administrators in the Admin Dashboard.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {villages.map((v) => (
                <div
                  key={v.slug}
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
                    transition: 'all 0.2s',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ background: '#ecfdf5', color: '#0d9488', padding: '6px', borderRadius: '6px' }}>
                        <MapPin size={18} />
                      </div>
                      <h4 style={{ margin: 0, fontSize: '16px', color: 'var(--navy)' }}>{v.name}</h4>
                    </div>
                    <p style={{ margin: '0 0 14px', fontSize: '12.5px', color: '#64748b' }}>
                      Digitized GeoJSON boundary polygons available for cadastral analysis and dispute overlay.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleVillageChange(v.slug)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 600 }}
                  >
                    <span>View Cadastral Map</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : (
        /* When a Village IS selected: show Map + Inspector Grid */
        <div style={{ display: 'grid', gridTemplateColumns: selectedParcel ? '2fr 1fr' : '1fr', gap: '20px' }}>
          <Card
            title={`Cadastral Map · ${selectedVillageObj?.name || selectedVillageSlug}`}
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#dc2626', display: 'inline-block' }} />
                  High (3+ Cases)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#ea580c', display: 'inline-block' }} />
                  Medium (1-2)
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#0d9488', display: 'inline-block' }} />
                  Clear
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setSelectedVillageSlug('')}
                  style={{ marginLeft: '6px', fontSize: '11.5px', padding: '3px 8px' }}
                >
                  Change Village
                </button>
              </div>
            }
          >
            {loading ? (
              <div style={{ height: '520px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
                Loading spatial boundaries…
              </div>
            ) : filteredGeoJson && filteredGeoJson.features?.length > 0 ? (
              <GisMap
                featureCollection={filteredGeoJson}
                casesBySurvey={litigationBySurvey}
                height="520px"
                showLabels={true}
                onSelectSurvey={handleSelectSurvey}
              />
            ) : (
              <div style={{ height: '520px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b', gap: '8px' }}>
                <Info size={28} style={{ color: '#94a3b8' }} />
                <div>No parcel polygons matched the current filter.</div>
                {filterMode !== 'all' && (
                  <button className="btn btn-outline btn-sm" onClick={() => setFilterMode('all')}>
                    Show All Parcels
                  </button>
                )}
              </div>
            )}
          </Card>

          {/* Selected Parcel Inspector Drawer */}
          {selectedParcel && (
            <Card
              title={`Parcel Sy. ${selectedParcel.surveyNo}`}
              right={
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setSelectedParcel(null)}
                  style={{ padding: '2px 8px', fontSize: '11px' }}
                >
                  Close
                </button>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                {/* Litigation Status Banner */}
                {selectedParcel.dispute ? (
                  <div style={{ padding: '10px 12px', background: '#fee2e2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                    <div style={{ fontWeight: 700, color: '#991b1b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertTriangle size={15} />
                      Active Litigation Hotspot
                    </div>
                    <div style={{ fontSize: '12px', color: '#7f1d1d', marginTop: '4px' }}>
                      <strong>{selectedParcel.dispute.total}</strong> total case(s) · <strong>{selectedParcel.dispute.open}</strong> currently open
                    </div>
                    {selectedParcel.dispute.band && (
                      <div style={{ marginTop: '6px' }}>
                        <Badge tone={bandTone(selectedParcel.dispute.band)}>Risk Band: {selectedParcel.dispute.band}</Badge>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '10px 12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontWeight: 700, color: '#166534' }}>
                      Clear Title · No Litigation
                    </div>
                    <div style={{ fontSize: '12px', color: '#15803d', marginTop: '4px' }}>
                      0 active or historical court cases recorded against this survey boundary.
                    </div>
                  </div>
                )}

                {/* Spatial Geometry Stats */}
                <div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--navy)' }}>Geometric Extent</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Calculated Area</div>
                      <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
                        {selectedParcel.props?.area_sqm ? Number(selectedParcel.props.area_sqm).toLocaleString('en-IN') + ' m²' : '—'}
                      </div>
                    </div>
                    <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Hectares</div>
                      <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
                        {selectedParcel.props?.area_sqm ? (Number(selectedParcel.props.area_sqm) / 10000).toFixed(3) + ' Ha' : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Centroid Coordinates */}
                {selectedParcel.props?.centroid_lat && (
                  <div>
                    <h4 style={{ margin: '0 0 4px', fontSize: '13px', color: 'var(--navy)' }}>Centroid Location</h4>
                    <div style={{ fontSize: '12.5px', color: '#334155' }}>
                      Lat: <b>{selectedParcel.props.centroid_lat}</b>, Lng: <b>{selectedParcel.props.centroid_lng}</b>
                    </div>
                  </div>
                )}

                {/* Linked Attributes */}
                <div>
                  <h4 style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--navy)' }}>Registry Attributes</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px' }}>
                    <div><b>Village:</b> {selectedParcel.props?.village || selectedVillageObj?.name || 'N/A'}</div>
                    {selectedParcel.props?.patta_no && <div><b>Patta No:</b> {selectedParcel.props.patta_no}</div>}
                    {selectedParcel.props?.owner && <div><b>Owner:</b> {selectedParcel.props.owner}</div>}
                    {selectedParcel.props?.subdivision && <div><b>Subdivision:</b> {selectedParcel.props.subdivision}</div>}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

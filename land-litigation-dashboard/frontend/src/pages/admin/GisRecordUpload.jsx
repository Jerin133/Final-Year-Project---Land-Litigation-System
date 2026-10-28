import { useState, useEffect } from 'react'
import { gisApi } from '../../lib/api.js'
import { TN_DISTRICTS, getTaluksForDistrict } from '../../lib/tnLocations.js'
import GisMap from '../../components/GisMap.jsx'
import {
  Layers,
  UploadCloud,
  CheckCircle2,
  X,
  RefreshCw,
  MapPin,
  Eye,
  Info
} from 'lucide-react'

export default function GisRecordUpload({ onGisUpdated }) {
  const [villages, setVillages] = useState([])
  const [loadingVillages, setLoadingVillages] = useState(true)

  // Form State
  const [district, setDistrict] = useState('Dharmapuri')
  const [taluk, setTaluk] = useState('Harur')
  const [villageName, setVillageName] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileDetails, setFileDetails] = useState(null)

  // Execution State
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [logs, setLogs] = useState([])

  // Map Preview State
  const [previewVillage, setPreviewVillage] = useState(null)
  const [previewGeoJson, setPreviewGeoJson] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const taluksList = getTaluksForDistrict(district)

  useEffect(() => {
    loadVillages()
  }, [])

  async function loadVillages() {
    setLoadingVillages(true)
    try {
      const list = await gisApi.villages()
      setVillages(list || [])
    } catch (err) {
      console.error('Failed to load GIS villages', err)
      setError('Could not reach GIS service on port 8002. Please ensure the GIS server is active.')
    } finally {
      setLoadingVillages(false)
    }
  }

  async function loadVillagePreview(village) {
    setPreviewVillage(village)
    setLoadingPreview(true)
    try {
      const geo = await gisApi.polygons(village.slug)
      setPreviewGeoJson(geo)
    } catch (err) {
      console.error('Failed to load polygon preview', err)
    } finally {
      setLoadingPreview(false)
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return

    setSelectedFile(file)
    setFileDetails({
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB',
    })

    // If village name is blank, infer from file name
    if (!villageName) {
      const suggested = file.name
        .replace(/\.geojson$/i, '')
        .replace(/\.json$/i, '')
        .replace(/[_\- ]*surveys?$/i, '')
        .replace(/[_\-]+/g, ' ')
        .trim()
      if (suggested) {
        setVillageName(suggested.charAt(0).toUpperCase() + suggested.slice(1))
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLogs([])

    if (!villageName.trim()) {
      return setError('Please enter a village name.')
    }
    if (!selectedFile) {
      return setError('Please select a GeoJSON cadastral map file.')
    }

    setBusy(true)
    setLogs((prev) => [...prev, `Reading file "${selectedFile.name}"...`])

    try {
      const text = await selectedFile.text()
      setLogs((prev) => [...prev, `Validating GeoJSON structure (${(selectedFile.size / 1024).toFixed(1)} KB)...`])

      const res = await gisApi.uploadVillage(villageName.trim(), text)
      setLogs((prev) => [
        ...prev,
        `Success! Parsed and indexed ${res.count || 'all'} survey boundary polygons.`,
        `Stored under village slug: "${res.slug}"`,
      ])

      setSuccess(`Village "${res.name}" successfully added to the GIS Cadastral Registry with ${res.count} survey parcels!`)
      setSelectedFile(null)
      setFileDetails(null)
      setVillageName('')

      // Reload list and switch preview
      await loadVillages()
      if (res.slug) {
        loadVillagePreview({ slug: res.slug, name: res.name })
      }
      if (onGisUpdated) onGisUpdated()
    } catch (err) {
      const msg = err.message || 'Failed to upload and parse GIS file'
      setError(msg)
      setLogs((prev) => [...prev, `ERROR: ${msg}`])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      {/* Upload Card */}
      <div className="card">
        <div className="card-head">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ background: '#ecfdf5', color: '#0d9488', padding: '10px', borderRadius: '10px', flexShrink: 0 }}>
              <Layers size={22} />
            </div>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '18px', color: 'var(--navy)' }}>
                Cadastral GIS Map Integration
              </h3>
              <p className="muted" style={{ margin: 0, fontSize: '13px', lineHeight: 1.5 }}>
                Upload digitized survey boundaries in GeoJSON format (EPSG:4326 or EPSG:3857) to enable geographic parcel visualization, area verification, and litigation hotspot mapping.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={loadVillages}
            disabled={loadingVillages}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={13} className={loadingVillages ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: '8px' }}>
          <div className="admin-form-grid">
            <label style={{ margin: 0 }}>
              District (Tamil Nadu)
              <select
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value)
                  setTaluk('')
                }}
                disabled={busy}
                style={{ height: '42px', marginTop: '6px' }}
              >
                <option value="">-- Select District --</option>
                {TN_DISTRICTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>

            <label style={{ margin: 0 }}>
              Taluk
              <select
                value={taluk}
                onChange={(e) => setTaluk(e.target.value)}
                disabled={busy || !district}
                style={{ height: '42px', marginTop: '6px' }}
              >
                <option value="">-- Select Taluk --</option>
                {taluksList.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label style={{ margin: 0 }}>
              Village Name
              <input
                type="text"
                placeholder="e.g. Kudumiyampatty"
                value={villageName}
                onChange={(e) => setVillageName(e.target.value)}
                disabled={busy}
                style={{ height: '42px', marginTop: '6px' }}
                required
              />
            </label>
          </div>

          {/* File Dropzone */}
          <div style={{ marginTop: '18px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '13.5px', color: '#334155' }}>
              Survey Boundary GeoJSON File
            </label>
            <div
              style={{
                border: selectedFile ? '2px solid #0d9488' : '2px dashed var(--border-strong)',
                background: selectedFile ? '#f0fdf4' : '#fafafa',
                borderRadius: '10px',
                padding: '28px 20px',
                textAlign: 'center',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <input
                type="file"
                accept=".geojson,.json"
                onChange={handleFileChange}
                disabled={busy}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  cursor: 'pointer',
                  width: '100%',
                  height: '100%',
                }}
              />
              <UploadCloud size={34} style={{ color: selectedFile ? '#0d9488' : '#94a3b8', margin: '0 auto 10px' }} />
              {selectedFile ? (
                <div>
                  <div style={{ fontWeight: 700, color: '#0f766e', fontSize: '15px' }}>
                    {fileDetails?.name}
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '3px' }}>
                    {fileDetails?.size} · Ready for ingestion
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14.5px', color: 'var(--navy)' }}>
                    Click or drag &amp; drop survey GeoJSON file
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>
                    Standard GeoJSON FeatureCollection of Polygons or MultiPolygons with <span className="code-pill">survey_no</span> property
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Format Guidance Box */}
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '12.5px',
              color: '#475569',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              lineHeight: 1.5,
            }}
          >
            <Info size={17} style={{ color: '#0284c7', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Auto-Detected Attributes:</strong> The system automatically extracts{' '}
              <span className="code-pill">survey_no</span>,{' '}
              <span className="code-pill">area</span>,{' '}
              <span className="code-pill">owner</span>,{' '}
              <span className="code-pill">patta_no</span>, and{' '}
              <span className="code-pill">subdivision</span>.{' '}
              Coordinates can be in WGS84 (<span className="code-pill">EPSG:4326</span>) or Web Mercator (<span className="code-pill">EPSG:3857</span>).
            </div>
          </div>

          {/* Feedback & Actions */}
          {error && (
            <div className="alert alert-error" style={{ marginTop: '16px' }}>
              <X size={15} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="alert alert-ok" style={{ marginTop: '16px' }}>
              <CheckCircle2 size={15} />
              <span>{success}</span>
            </div>
          )}

          <div className="form-actions-row" style={{ marginTop: '22px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !selectedFile}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: '180px', justifyContent: 'center', height: '42px', fontWeight: 600 }}
            >
              <UploadCloud size={16} />
              {busy ? 'Validating & Uploading…' : 'Upload & Register GIS Data'}
            </button>
          </div>
        </form>

        {/* Live Execution Logs */}
        {logs.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)', marginBottom: '8px' }}>
              Ingestion Terminal Log
            </h4>
            <div className="log-terminal">
              {logs.map((line, idx) => (
                <div key={idx} className="log-line">
                  <span className="log-prompt">&gt;</span> {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Registered GIS Villages List & Map Preview Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '22px' }}>
        {/* Villages List Card */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: '16px', color: 'var(--navy)' }}>
                Registered GIS Villages ({villages.length})
              </h3>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Live on Port 8002</span>
            </div>
          </div>

          {loadingVillages ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
              Checking GIS registry…
            </div>
          ) : villages.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
              No GIS cadastral files uploaded yet. Upload a village survey GeoJSON above.
            </div>
          ) : (
            <div className="table-wrap" style={{ marginTop: '8px' }}>
              <table>
                <thead>
                  <tr>
                    <th>Village Name</th>
                    <th>Type</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {villages.map((v) => {
                    const isSelected = previewVillage?.slug === v.slug
                    return (
                      <tr key={v.slug} style={{ background: isSelected ? '#f0fdf4' : 'transparent' }}>
                        <td>
                          <strong style={{ fontSize: '13.5px', color: 'var(--navy)' }}>{v.name}</strong>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>slug: {v.slug}</div>
                        </td>
                        <td>
                          <span className="role-pill gov" style={{ fontSize: '11.5px', padding: '3px 10px', fontWeight: 600 }}>
                            Registered Village
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => loadVillagePreview(v)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }}
                          >
                            <Eye size={13} />
                            <span>{isSelected ? 'Viewing' : 'Inspect Map'}</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Live Cadastral Map Preview Card */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ background: '#ecfdf5', color: '#0d9488', padding: '6px', borderRadius: '6px' }}>
                <MapPin size={17} />
              </div>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--navy)' }}>Cadastral Boundary Viewer</h3>
            </div>
            {previewVillage && (
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f766e', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '3px 10px', borderRadius: '6px' }}>
                {previewVillage.name}
              </span>
            )}
          </div>

          <div style={{ marginTop: '8px' }}>
            {loadingPreview ? (
              <div style={{ height: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
                Rendering survey boundary polygons…
              </div>
            ) : previewGeoJson ? (
              <div>
                <GisMap
                  featureCollection={previewGeoJson}
                  height="380px"
                  showLabels={true}
                />
                <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <strong>{previewGeoJson.features?.length || 0} survey boundary parcels rendered</strong>
                  <span>Click any parcel on the map for details</span>
                </div>
              </div>
            ) : (
              <div style={{ height: '380px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', color: '#94a3b8', gap: '6px' }}>
                <MapPin size={28} style={{ opacity: 0.6 }} />
                <span style={{ fontSize: '13px', color: '#64748b' }}>Select a village above and click &quot;Inspect Map&quot;</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

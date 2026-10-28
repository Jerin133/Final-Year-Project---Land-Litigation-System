import { useState, useEffect } from 'react'
import { adminApi, landApi } from '../../lib/api.js'
import { TN_DISTRICTS, getTaluksForDistrict } from '../../lib/tnLocations.js'
import {
  Plus,
  RefreshCw,
  FileText,
  Archive,
  UploadCloud,
  Trash2,
  CheckCircle2,
  X,
  FileSpreadsheet,
  Check
} from 'lucide-react'

export default function LandRecordUpload({ onVillageUpdated }) {
  const [villages, setVillages] = useState([])
  const [loadingVillages, setLoadingVillages] = useState(true)

  // Form State
  const [mode, setMode] = useState('add') // 'add' | 'replace'
  const [format, setFormat] = useState('single') // 'single' | 'zip'
  const [district, setDistrict] = useState('')
  const [taluk, setTaluk] = useState('')
  const [villageName, setVillageName] = useState('')
  const [replaceDocType, setReplaceDocType] = useState('both') // 'both' | 'areg' | 'chitta'

  // Files
  const [aregFiles, setAregFiles] = useState([])   // File[]
  const [chittaFiles, setChittaFiles] = useState([]) // File[]
  const [zipFile, setZipFile] = useState(null)

  // Submission / Execution State
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [logs, setLogs] = useState([])
  const [lastStats, setLastStats] = useState(null)

  const taluksList = getTaluksForDistrict(district)

  useEffect(() => {
    loadVillages()
  }, [])

  async function loadVillages() {
    setLoadingVillages(true)
    try {
      const res = await adminApi.getVillagesDetailed()
      setVillages(res.villages || [])
    } catch (err) {
      console.error('Failed to load registered villages', err)
    } finally {
      setLoadingVillages(false)
    }
  }

  function handleDistrictChange(newDistrict) {
    setDistrict(newDistrict)
    setTaluk('')
  }

  function handleSelectReplaceVillage(v) {
    setMode('replace')
    setDistrict(v.district || '')
    setTaluk(v.taluk || '')
    setVillageName(v.village || '')
    setReplaceDocType('both')
    setAregFiles([])
    setChittaFiles([])
    setZipFile(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLogs([])
    setLastStats(null)

    if (!district) return setError('Please select a District.')
    if (!taluk) return setError('Please select a Taluk.')
    if (!villageName.trim()) return setError('Please enter or select a Village name.')

    setBusy(true)

    try {
      if (mode === 'add') {
        let res
        if (format === 'zip') {
          if (!zipFile) throw new Error('Please select a bulk ZIP archive.')
          setLogs(prev => [...prev, `Uploading ZIP archive (${(zipFile.size / 1024 / 1024).toFixed(2)} MB)...`])
          res = await adminApi.uploadVillageZip(district, taluk, villageName.trim(), zipFile)
        } else {
          if (aregFiles.length === 0) throw new Error('Please select at least one A-Register PDF.')
          if (chittaFiles.length === 0) throw new Error('Please select at least one Chitta PDF.')
          setLogs(prev => [
            ...prev,
            `Uploading ${aregFiles.length} A-Register file(s) and ${chittaFiles.length} Chitta file(s)...`
          ])
          res = await adminApi.uploadVillagePdfs(district, taluk, villageName.trim(), aregFiles, chittaFiles)
        }

        setLogs(prev => [
          ...prev,
          `Server accepted files. Initiating registry integration pipeline...`,
          res.message || 'Processing complete.'
        ])

        if (res.stats) {
          setLastStats(res.stats)
          setLogs(prev => [
            ...prev,
            `Parsed ${res.stats.pattas_count} pattas, ${res.stats.owners_count} owners, ${res.stats.survey_rows} survey rows.`
          ])
        }

        setSuccess(`Village "${villageName.trim()}" integrated successfully into Land Records Registry!`)
        // Clear files
        setAregFiles([])
        setChittaFiles([])
        setZipFile(null)
      } else {
        // Mode === 'replace'
        let res
        if (replaceDocType === 'both' && format === 'zip' && zipFile) {
          setLogs(prev => [...prev, `Uploading replacement ZIP for village ${villageName}...`])
          res = await adminApi.replaceVillageDocuments(
            villageName.trim(),
            district,
            taluk,
            'both',
            [],
            [],
            zipFile
          )
        } else {
          if ((replaceDocType === 'both' || replaceDocType === 'areg') && aregFiles.length === 0) {
            throw new Error('Please select replacement A-Register PDF(s).')
          }
          if ((replaceDocType === 'both' || replaceDocType === 'chitta') && chittaFiles.length === 0) {
            throw new Error('Please select replacement Chitta PDF(s).')
          }

          setLogs(prev => [
            ...prev,
            `Uploading replacement files for village ${villageName} (scope: ${replaceDocType})...`
          ])
          res = await adminApi.replaceVillageDocuments(
            villageName.trim(),
            district,
            taluk,
            replaceDocType,
            aregFiles,
            chittaFiles,
            null
          )
        }

        setLogs(prev => [
          ...prev,
          `Documents replaced. Re-parsing land records...`,
          res.message || 'Processing complete.'
        ])

        if (res.stats) {
          setLastStats(res.stats)
          setLogs(prev => [
            ...prev,
            `Re-indexed: ${res.stats.pattas_count} pattas, ${res.stats.owners_count} owners, ${res.stats.survey_rows} surveys.`
          ])
        }

        setSuccess(`Village "${villageName.trim()}" documents successfully replaced and re-integrated!`)
        setAregFiles([])
        setChittaFiles([])
        setZipFile(null)
      }

      await loadVillages()
      if (onVillageUpdated) onVillageUpdated()
    } catch (err) {
      console.error('Integration failure:', err)
      setError(err.message || 'Integration pipeline failed.')
      setLogs(prev => [...prev, `[ERROR] ${err.message || 'Pipeline terminated with error.'}`])
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteVillage(vName) {
    if (!window.confirm(`Are you sure you want to delete all land records and PDFs for "${vName}"? This cannot be undone.`)) {
      return
    }

    try {
      await adminApi.deleteVillage(vName)
      await loadVillages()
      if (onVillageUpdated) onVillageUpdated()
    } catch (err) {
      alert('Delete failed: ' + err.message)
    }
  }

  return (
    <div>
      {/* Upload / Replace Card */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>
              <FileSpreadsheet size={16} />
              Land Records Intake &amp; Registry Integration
            </h3>
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              Upload official Chitta (ownership &amp; extents) and A-Register (land classifications &amp; tenure) documents.
              Use <strong>Add Village Documents</strong> for new villages or <strong>Replace Village Documents</strong> to update and re-parse land records for an existing village.
            </p>
          </div>
          <div className="mode-toggle">
            <button
              type="button"
              className={mode === 'add' ? 'active' : ''}
              onClick={() => { setMode('add'); setVillageName(''); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Plus size={13} />
              Add Village Documents
            </button>
            <button
              type="button"
              className={mode === 'replace' ? 'active' : ''}
              onClick={() => { setMode('replace'); setReplaceDocType('both'); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <RefreshCw size={13} />
              Replace Village Documents
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-ok">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="admin-form-grid">
            <label>
              District (Tamil Nadu)
              <select
                required
                value={district}
                onChange={(e) => handleDistrictChange(e.target.value)}
              >
                <option value="">-- Select District --</option>
                {TN_DISTRICTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>

            <label>
              Taluk ({district || 'Tamil Nadu'})
              <select
                required
                value={taluk}
                onChange={(e) => setTaluk(e.target.value)}
                disabled={!district}
              >
                <option value="">{district ? '-- Select Taluk --' : '-- Choose District first --'}</option>
                {taluksList.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label>
              Village Name
              {mode === 'replace' ? (
                <select
                  required
                  value={villageName}
                  onChange={(e) => setVillageName(e.target.value)}
                >
                  <option value="">-- Select Village to Replace --</option>
                  {villages.map((v) => (
                    <option key={v.village} value={v.village}>
                      {v.village} ({v.taluk}, {v.district})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  type="text"
                  placeholder="e.g. Melpakkam"
                  value={villageName}
                  onChange={(e) => setVillageName(e.target.value)}
                />
              )}
            </label>
          </div>

          {/* Mode-specific Controls */}
          {mode === 'replace' && (
            <div style={{ marginTop: '16px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#344054', marginRight: '14px' }}>
                Replace Scope:
              </span>
              <div className="mode-toggle" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className={replaceDocType === 'both' ? 'active' : ''}
                  onClick={() => setReplaceDocType('both')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <FileText size={13} />
                  Both A-Register &amp; Chitta
                </button>
                <button
                  type="button"
                  className={replaceDocType === 'areg' ? 'active' : ''}
                  onClick={() => setReplaceDocType('areg')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <FileText size={13} />
                  Only A-Register PDF
                </button>
                <button
                  type="button"
                  className={replaceDocType === 'chitta' ? 'active' : ''}
                  onClick={() => setReplaceDocType('chitta')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <FileText size={13} />
                  Only Chitta PDF
                </button>
              </div>
            </div>
          )}

          {mode === 'add' && (
            <div style={{ marginTop: '16px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#344054', marginRight: '14px' }}>
                Upload Format:
              </span>
              <div className="mode-toggle" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className={format === 'single' ? 'active' : ''}
                  onClick={() => setFormat('single')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <FileText size={13} />
                  Single PDFs (A-Reg + Chitta)
                </button>
                <button
                  type="button"
                  className={format === 'zip' ? 'active' : ''}
                  onClick={() => setFormat('zip')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <Archive size={13} />
                  Bulk ZIP Archive
                </button>
              </div>
            </div>
          )}

          {/* File Upload Boxes */}
          {(mode === 'add' && format === 'zip') ? (
            <div style={{ marginTop: '12px' }}>
              <div className="upload-box" onClick={() => document.getElementById('zip-file-input').click()}>
                <input
                  id="zip-file-input"
                  type="file"
                  accept=".zip"
                  style={{ display: 'none' }}
                  onChange={(e) => setZipFile(e.target.files[0] || null)}
                />
                <div className="upload-box-icon">
                  <Archive size={32} />
                </div>
                <div className="upload-box-title">Upload Village Bulk ZIP Archive</div>
                <div className="upload-box-desc">
                  Archive containing both <strong>areg.pdf</strong> and <strong>chitta.pdf</strong>.
                  File names must contain <em>areg</em> / <em>a_reg</em> / <em>adangal</em> for A-Register
                  and <em>chitta</em> / <em>patta</em> for Chitta. If only 2 PDFs exist, the smaller is treated as A-Register.
                </div>
                {zipFile && (
                  <div className="file-selected-badge">
                    <Check size={14} />
                    {zipFile.name} ({(zipFile.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="upload-grid-2">
              {/* A-Register Box */}
              {(mode === 'add' || replaceDocType === 'both' || replaceDocType === 'areg') && (
                <div
                  className={`upload-box ${aregFiles.length > 0 ? 'upload-box--has-files' : ''}`}
                  onClick={() => document.getElementById('areg-file-input').click()}
                >
                  <input
                    id="areg-file-input"
                    type="file"
                    accept=".pdf"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => setAregFiles(Array.from(e.target.files || []))}
                  />
                  <div className="upload-box-icon">
                    <FileText size={32} />
                  </div>
                  <div className="upload-box-title">{mode === 'replace' ? 'Replacement A-Register PDF(s)' : '1. A-Register PDF (AREG Extract)'}</div>
                  <div className="upload-box-desc">Contains survey numbers, subdivisions, soil types, tenure &amp; tax</div>
                  {aregFiles.length > 0 ? (
                    <div className="file-list" onClick={(ev) => ev.stopPropagation()}>
                      {aregFiles.map((f, i) => (
                        <div key={i} className="file-list-item">
                          <span className="file-list-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <FileText size={12} />
                            {f.name}
                          </span>
                          <span className="file-list-size">({(f.size / 1024 / 1024).toFixed(2)} MB)</span>
                          <button
                            type="button"
                            className="file-list-remove"
                            onClick={() => setAregFiles(prev => prev.filter((_, j) => j !== i))}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      <div className="file-list-add" onClick={() => document.getElementById('areg-file-input').click()}>
                        + Add more files
                      </div>
                    </div>
                  ) : (
                    <div className="upload-box-hint">Click to select one or more PDF files</div>
                  )}
                </div>
              )}

              {/* Chitta Box */}
              {(mode === 'add' || replaceDocType === 'both' || replaceDocType === 'chitta') && (
                <div
                  className={`upload-box ${chittaFiles.length > 0 ? 'upload-box--has-files' : ''}`}
                  onClick={() => document.getElementById('chitta-file-input').click()}
                >
                  <input
                    id="chitta-file-input"
                    type="file"
                    accept=".pdf"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => setChittaFiles(Array.from(e.target.files || []))}
                  />
                  <div className="upload-box-icon">
                    <FileSpreadsheet size={32} />
                  </div>
                  <div className="upload-box-title">{mode === 'replace' ? 'Replacement Chitta PDF(s)' : '2. Chitta PDF (Rural Land Records)'}</div>
                  <div className="upload-box-desc">Contains patta numbers, land owners, relations &amp; survey extents</div>
                  {chittaFiles.length > 0 ? (
                    <div className="file-list" onClick={(ev) => ev.stopPropagation()}>
                      {chittaFiles.map((f, i) => (
                        <div key={i} className="file-list-item">
                          <span className="file-list-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <FileText size={12} />
                            {f.name}
                          </span>
                          <span className="file-list-size">({(f.size / 1024 / 1024).toFixed(2)} MB)</span>
                          <button
                            type="button"
                            className="file-list-remove"
                            onClick={() => setChittaFiles(prev => prev.filter((_, j) => j !== i))}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      <div className="file-list-add" onClick={() => document.getElementById('chitta-file-input').click()}>
                        + Add more files
                      </div>
                    </div>
                  ) : (
                    <div className="upload-box-hint">Click to select one or more PDF files</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-actions-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {busy ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  Processing &amp; Integrating…
                </>
              ) : mode === 'replace' ? (
                <>
                  <RefreshCw size={14} />
                  Replace Documents &amp; Re-integrate
                </>
              ) : (
                <>
                  <UploadCloud size={14} />
                  Parse &amp; Integrate Land Records
                </>
              )}
            </button>
            {busy && <span className="muted" style={{ fontSize: '13px' }}>Parsing PDFs with table detectors, please wait…</span>}
          </div>
        </form>

        {logs.length > 0 && (
          <div className="log-terminal">
            <div style={{ color: '#94a3b8', marginBottom: '6px' }}>Terminal Execution Output:</div>
            {logs.map((l, i) => (
              <div key={i} className={`log-line ${l.includes('[ERROR]') ? 'log-error' : l.includes('successfully') ? 'log-success' : ''}`}>
                &gt; {l}
              </div>
            ))}
          </div>
        )}

        {lastStats && (
          <div style={{ marginTop: '16px', background: '#ecfdf5', padding: '14px 18px', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
            <strong style={{ color: '#065f46', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={16} />
              Integration Summary:
            </strong>
            <div style={{ display: 'flex', gap: '24px', marginTop: '8px', flexWrap: 'wrap', fontSize: '13.5px', color: '#047857' }}>
              <div><b>Pattas:</b> {lastStats.pattas_count}</div>
              <div><b>Owners:</b> {lastStats.owners_count}</div>
              <div><b>Survey Rows:</b> {lastStats.survey_rows}</div>
              <div><b>A-Reg Subdivisions:</b> {lastStats.areg_subdivisions}</div>
              <div><b>Survey Totals:</b> {lastStats.areg_totals}</div>
            </div>
          </div>
        )}
      </div>

      {/* Villages List Table */}
      <div className="card">
        <div className="card-head">
          <h3>Registered Villages on Live System ({villages.length})</h3>
          <button className="btn btn-sm btn-outline" onClick={loadVillages} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <RefreshCw size={13} />
            Refresh Table
          </button>
        </div>

        {loadingVillages ? (
          <div className="empty">Loading villages…</div>
        ) : villages.length === 0 ? (
          <div className="empty">No villages registered yet. Upload one above.</div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Village</th>
                  <th>Taluk</th>
                  <th>District</th>
                  <th>Distinct Surveys</th>
                  <th>Pattas</th>
                  <th>Owners</th>
                  <th>PDFs on Disk</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {villages.map((v) => (
                  <tr key={v.village}>
                    <td><strong>{v.village}</strong></td>
                    <td>{v.taluk}</td>
                    <td>{v.district}</td>
                    <td>{v.survey_count?.toLocaleString('en-IN') || 0}</td>
                    <td>{v.patta_count?.toLocaleString('en-IN') || 0}</td>
                    <td>{v.owner_count?.toLocaleString('en-IN') || 0}</td>
                    <td>
                      <span className={`badge ${v.areg_pdf && v.chitta_pdf ? 'badge-green' : 'badge-orange'}`}>
                        {v.areg_pdf && v.chitta_pdf ? 'A-Reg & Chitta OK' : 'Partial / Missing'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleSelectReplaceVillage(v)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <RefreshCw size={12} />
                          Replace Documents
                        </button>
                        <button
                          className="btn btn-sm btn-danger-outline"
                          onClick={() => handleDeleteVillage(v.village)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Trash2 size={12} />
                          Delete Village
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

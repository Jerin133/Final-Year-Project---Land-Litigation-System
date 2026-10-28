import { useState, useEffect } from 'react'
import { adminApi, caseApi } from '../../lib/api.js'
import { TN_DISTRICTS, getTaluksForDistrict } from '../../lib/tnLocations.js'
import { cleanTamilText } from '../../lib/util.js'
import {
  Scale,
  Plus,
  RefreshCw,
  FileText,
  Archive,
  MapPin,
  AlertTriangle,
  Info,
  Check,
  CheckCircle2,
  X,
  Search,
  UploadCloud,
} from 'lucide-react'

export default function CourtCaseUpload({ onCasesUpdated }) {
  const [stats, setStats] = useState(null)
  const [loadingStats, setLoadingStats] = useState(true)

  // Registered Villages with Land Records (from Module 1)
  const [registeredVillages, setRegisteredVillages] = useState([])
  const [loadingVillages, setLoadingVillages] = useState(true)

  // Upload Form State
  const [mode, setMode] = useState('add') // 'add' | 'replace'
  const [format, setFormat] = useState('single') // 'single' | 'zip'
  const [district, setDistrict] = useState('')
  const [taluk, setTaluk] = useState('')
  const [selectedVillage, setSelectedVillage] = useState('')

  // Replace Scope & Target
  const [replaceScope, setReplaceScope] = useState('all') // 'all' | 'specific' | 'english' | 'tamil'
  const [selectedCaseId, setSelectedCaseId] = useState('')
  const [villageCases, setVillageCases] = useState([])
  const [loadingVillageCases, setLoadingVillageCases] = useState(false)

  // Files
  const [englishFiles, setEnglishFiles] = useState([])
  const [tamilFiles, setTamilFiles] = useState([])
  const [zipFile, setZipFile] = useState(null)

  // Submission State
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [uploadResult, setUploadResult] = useState(null)

  // Live Case Explorer
  const [cases, setCases] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingCases, setLoadingCases] = useState(false)

  const taluksList = getTaluksForDistrict(district)

  useEffect(() => {
    loadStats()
    loadRegisteredVillages()
    loadSampleCases()
  }, [])

  // When selected village changes, load its specific indexed court cases
  useEffect(() => {
    if (selectedVillage) {
      loadVillageCases(selectedVillage)
    } else {
      setVillageCases([])
      setSelectedCaseId('')
    }
  }, [selectedVillage])

  async function loadStats() {
    setLoadingStats(true)
    try {
      const res = await adminApi.getCaseStats()
      setStats(res)
    } catch (err) {
      console.error('Failed to load court case stats', err)
    } finally {
      setLoadingStats(false)
    }
  }

  async function loadRegisteredVillages() {
    setLoadingVillages(true)
    try {
      const res = await adminApi.getVillagesDetailed()
      const all = res.villages || []
      // Only villages that have land records in Module 1
      const withLandRecords = all.filter(
        (v) => v.in_database || v.survey_count > 0 || v.patta_count > 0 || (v.areg_pdf && v.chitta_pdf)
      )
      setRegisteredVillages(withLandRecords)
    } catch (err) {
      console.error('Failed to load registered villages from Module 1', err)
    } finally {
      setLoadingVillages(false)
    }
  }

  function normalizeVillageName(name) {
    if (!name) return ''
    let s = name.trim().toLowerCase()
    if (s.endsWith('patty')) s = s.slice(0, -5) + 'patti'
    else if (s.endsWith('patti')) s = s.slice(0, -5) + 'patty'
    return s
  }

  async function loadVillageCases(vName) {
    if (!vName) {
      setVillageCases([])
      setSelectedCaseId('')
      return
    }
    setLoadingVillageCases(true)
    try {
      const res = await caseApi.search({ village: vName })
      const found = res.cases || []
      setVillageCases(found)
      if (found.length > 0) {
        setSelectedCaseId(found[0].case_id)
      } else {
        setSelectedCaseId('')
      }
    } catch (err) {
      console.error('Failed to load cases for village ' + vName, err)
      setVillageCases([])
      setSelectedCaseId('')
    } finally {
      setLoadingVillageCases(false)
    }
  }

  async function loadSampleCases(q = '') {
    setLoadingCases(true)
    try {
      const res = await caseApi.search(q ? { survey: q } : {})
      setCases(res.cases || [])
    } catch (err) {
      console.error('Failed to load indexed cases', err)
    } finally {
      setLoadingCases(false)
    }
  }

  function handleDistrictChange(newDistrict) {
    setDistrict(newDistrict)
    setTaluk('')
    setSelectedVillage('')
  }

  function handleTalukChange(newTaluk) {
    setTaluk(newTaluk)
    setSelectedVillage('')
  }

  // Quick picker click from banner
  function handleQuickSelectVillage(v) {
    setDistrict(v.district || '')
    setTaluk(v.taluk || '')
    setSelectedVillage(v.village || '')
    setError('')
    setSuccess('')
  }

  // Check if chosen taluk has at least one registered village
  const availableVillagesForTaluk = registeredVillages.filter(
    (v) =>
      (!district || (v.district || '').toLowerCase() === district.toLowerCase()) &&
      (!taluk || (v.taluk || '').toLowerCase() === taluk.toLowerCase())
  )

  const hasLandRecordsForTaluk = availableVillagesForTaluk.length > 0

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setUploadResult(null)

    if (!district) return setError('Please choose a District.')
    if (!taluk) return setError('Please choose a Taluk.')
    if (!selectedVillage) return setError('Please choose a target Village that has existing land records.')

    setBusy(true)

    try {
      if (mode === 'add') {
        let res
        if (format === 'zip') {
          if (!zipFile) throw new Error('Please select a ZIP file of court case PDFs.')
          res = await adminApi.uploadCasesZip(selectedVillage, zipFile)
        } else {
          if (englishFiles.length === 0 && tamilFiles.length === 0) {
            throw new Error('Please select at least one English or Tamil PDF document.')
          }
          res = await adminApi.uploadCasesPdfs(selectedVillage, englishFiles, tamilFiles)
        }

        setUploadResult(res)
        setSuccess(
          `Successfully uploaded and indexed court case documents for village "${selectedVillage}". ${res.total_cases_indexed} cases now active.`
        )
        setEnglishFiles([])
        setTamilFiles([])
        setZipFile(null)
      } else {
        // Mode === 'replace'
        if (replaceScope === 'specific') {
          if (!selectedCaseId) throw new Error('Please select which specific case you wish to replace.')
          if (englishFiles.length === 0 && tamilFiles.length === 0) {
            throw new Error('Please provide at least one replacement PDF (English or Tamil) for case ' + selectedCaseId)
          }

          const res = await adminApi.replaceCaseDocument(
            selectedVillage,
            selectedCaseId,
            englishFiles[0] || null,
            tamilFiles[0] || null
          )

          setUploadResult(res)
          setSuccess(`Successfully replaced document for case ${selectedCaseId}. The risk and retrieval models have been updated.`)
          setEnglishFiles([])
          setTamilFiles([])
        } else {
          // Replace all case documents for this village
          if (format === 'zip') {
            if (!zipFile) throw new Error('Please select a replacement ZIP archive.')
            const res = await adminApi.replaceAllVillageCases(selectedVillage, [], [], zipFile)
            setUploadResult(res)
            setSuccess(`All court case documents for village "${selectedVillage}" have been replaced with the contents of the ZIP archive.`)
            setZipFile(null)
          } else {
            if (englishFiles.length === 0 && tamilFiles.length === 0) {
              throw new Error('Please provide at least one replacement English or Tamil case PDF.')
            }
            const res = await adminApi.replaceAllVillageCases(selectedVillage, englishFiles, tamilFiles, null)
            setUploadResult(res)
            setSuccess(`All court case documents for village "${selectedVillage}" have been replaced and re-indexed.`)
            setEnglishFiles([])
            setTamilFiles([])
          }
        }
      }

      await loadStats()
      await loadSampleCases()
      await loadVillageCases(selectedVillage)
      if (onCasesUpdated) onCasesUpdated()
    } catch (err) {
      console.error('Case upload failure:', err)
      setError(err.message || 'Case upload and indexing failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleReload() {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await adminApi.reloadCases()
      setSuccess(`Reloaded cases from disk. ${res.total_cases_indexed} active cases now in index.`)
      await loadStats()
      await loadSampleCases()
      if (onCasesUpdated) onCasesUpdated()
    } catch (err) {
      setError(err.message || 'Failed to reload cases.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* Upload Box Card */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3>
              <Scale size={16} />
              Court Case Intake &amp; AI Legal Document Extraction
            </h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '13px' }}>
              Upload court case judgment/petition documents in English and Tamil for villages that have registered revenue land records.
              The AI extraction pipeline automatically extracts dispute types, parties, and survey numbers without manual spreadsheets.
            </p>
          </div>
          <div className="mode-toggle">
            <button
              type="button"
              className={mode === 'add' ? 'active' : ''}
              onClick={() => setMode('add')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Plus size={13} />
              Add Case Documents
            </button>
            <button
              type="button"
              className={mode === 'replace' ? 'active' : ''}
              onClick={() => { setMode('replace'); setFormat('single'); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <RefreshCw size={13} />
              Replace Case Documents
            </button>
          </div>
        </div>

        {/* Stats Row */}
        {stats && (
          <div className="admin-stats-grid">
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>TOTAL CASES INDEXED</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>{stats.total_cases}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>ENGLISH DOCUMENTS</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#2563eb' }}>{stats.english_pdfs}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>TAMIL DOCUMENTS</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#7c3aed' }}>{stats.tamil_pdfs}</div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>VILLAGES COVERED</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#059669' }}>{stats.villages?.length || 0}</div>
            </div>
          </div>
        )}

        {/* Quick Picker for Registered Villages */}
        {registeredVillages.length > 0 && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd', fontSize: '13px' }}>
            <span style={{ fontWeight: 600, color: '#0369a1', marginRight: '8px' }}>
              Registered Revenue Villages:
            </span>
            <span style={{ color: '#0284c7' }}>
              (Click to select:
              {registeredVillages.map((v) => (
                <button
                  key={v.village}
                  type="button"
                  onClick={() => handleQuickSelectVillage(v)}
                  style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: selectedVillage === v.village ? '1px solid #0284c7' : '1px solid #cbd5e1',
                    background: selectedVillage === v.village ? '#0284c7' : '#fff',
                    color: selectedVillage === v.village ? '#fff' : '#334155',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <MapPin size={11} />
                  {v.village} ({v.taluk}, {v.district})
                </button>
              ))}
              )
            </span>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-ok">{success}</div>}

        <form onSubmit={handleSubmit}>
          {/* Location Hierarchy: District -> Taluk -> Registered Village */}
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
                onChange={(e) => handleTalukChange(e.target.value)}
                disabled={!district}
              >
                <option value="">{district ? '-- Select Taluk --' : '-- Choose District first --'}</option>
                {taluksList.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label>
              Target Registered Revenue Village
              {hasLandRecordsForTaluk ? (
                <select
                  required
                  value={selectedVillage}
                  onChange={(e) => setSelectedVillage(e.target.value)}
                  style={{ fontWeight: selectedVillage ? 600 : 400 }}
                >
                  <option value="">-- Choose Target Village --</option>
                  {availableVillagesForTaluk.map((v) => (
                    <option key={v.village} value={v.village}>
                      {v.village} ({v.survey_count || 0} surveys on record)
                    </option>
                  ))}
                </select>
              ) : (
                <select disabled style={{ color: '#94a3b8' }}>
                  <option value="">-- No registered villages in this taluk --</option>
                </select>
              )}
            </label>
          </div>

          {/* Warning Banner if selected Taluk has no land records */}
          {!hasLandRecordsForTaluk && !loadingVillages && (
            <div style={{ marginTop: '14px', padding: '12px 14px', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fef3c7', color: '#92400e', fontSize: '13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={16} />
                <strong>Court cases can only be uploaded for villages with existing revenue land records:</strong>
              </div>
              <div style={{ marginTop: '4px' }}>
                There are currently no land records registered under <strong>{taluk}, {district}</strong> in the Revenue Registry.
                Please switch to the <strong>Land Records Registry</strong> tab first to upload the Chitta and A-Register documents for this village.
              </div>
            </div>
          )}

          {/* If village selected, display existing indexed court cases count */}
          {selectedVillage && (
            <div style={{ marginTop: '14px', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                Target Village: <strong style={{ color: '#0f172a' }}>{selectedVillage}</strong> ({taluk}, {district})
                <span style={{ marginLeft: '12px', color: '#64748b' }}>
                  {loadingVillageCases ? 'Loading indexed cases…' : `Currently indexed court cases: ${villageCases.length}`}
                </span>
              </div>
              {villageCases.length > 0 && (
                <span className="badge badge-green">Eligible for Case Retrieval</span>
              )}
            </div>
          )}

          {/* Replace Mode: Select WHICH file to replace */}
          {mode === 'replace' && hasLandRecordsForTaluk && (
            <div style={{ marginTop: '16px', padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '8px' }}>
                Select Replacement Scope for "{selectedVillage}":
              </div>

              <div className="mode-toggle" style={{ marginBottom: '12px' }}>
                <button
                  type="button"
                  className={replaceScope === 'all' ? 'active' : ''}
                  onClick={() => setReplaceScope('all')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <RefreshCw size={13} />
                  Replace All Case Documents for this Village
                </button>
                <button
                  type="button"
                  className={replaceScope === 'specific' ? 'active' : ''}
                  onClick={() => setReplaceScope('specific')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <FileText size={13} />
                  Replace a Specific Case Document ({loadingVillageCases ? '…' : villageCases.length})
                </button>
              </div>

              {replaceScope === 'specific' && (
                villageCases.length > 0 ? (
                  <div style={{ marginTop: '10px' }}>
                    <label style={{ fontWeight: 600, fontSize: '13px', color: '#334155' }}>
                      Select Existing Case to Replace:
                      <select
                        value={selectedCaseId}
                        onChange={(e) => setSelectedCaseId(e.target.value)}
                        style={{ marginTop: '4px' }}
                      >
                        {villageCases.map((c) => (
                          <option key={c.case_id} value={c.case_id}>
                            {c.case_id} — Survey {c.survey_no} ({cleanTamilText(c.petitioner) || 'Petitioner'} vs {cleanTamilText(c.respondent) || 'Respondent'})
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: '12px' }}>
                      Uploading a document below will replace this specific case entry and update the risk model.
                    </p>
                  </div>
                ) : (
                  <div style={{ marginTop: '10px', padding: '10px 12px', background: '#fffbeb', borderRadius: '6px', border: '1px solid #fef3c7', fontSize: '13px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Info size={15} />
                    <span>No individual court cases currently found for <strong>{selectedVillage}</strong>. You can use <strong>"Replace All Case Documents for this Village"</strong> or switch to <strong>"Add Case Documents"</strong> to upload court cases.</span>
                  </div>
                )
              )}
            </div>
          )}

          {/* Upload Format: Single / Multiple PDFs vs Bulk ZIP — only in Add mode */}
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
                  Single / Multiple PDFs
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

          {/* Upload Dropzones */}
          {format === 'single' ? (
            <div className="upload-grid-2">
              <div
                className={`upload-box ${englishFiles.length > 0 ? 'upload-box--has-files' : ''}`}
                onClick={() => document.getElementById('en-files-input').click()}
              >
                <input
                  id="en-files-input"
                  type="file"
                  accept=".pdf"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => setEnglishFiles(Array.from(e.target.files || []))}
                />
                <div className="upload-box-icon">
                  <Scale size={32} />
                </div>
                <div className="upload-box-title">
                  {mode === 'replace' && replaceScope === 'specific' ? 'Replacement English Case PDF' : 'English Case PDF(s)'}
                </div>
                <div className="upload-box-desc">
                  {mode === 'replace' && replaceScope === 'specific'
                    ? 'Upload replacement judgment / petition in English'
                    : 'Select one or multiple English case files (e.g. SYN-KUD-*.pdf)'}
                </div>
                {englishFiles.length > 0 ? (
                  <div className="file-list" onClick={(ev) => ev.stopPropagation()}>
                    {englishFiles.map((f, i) => (
                      <div key={i} className="file-list-item">
                        <span className="file-list-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <FileText size={12} />
                          {f.name}
                        </span>
                        <span className="file-list-size">({(f.size / 1024 / 1024).toFixed(2)} MB)</span>
                        <button
                          type="button"
                          className="file-list-remove"
                          onClick={() => setEnglishFiles(prev => prev.filter((_, j) => j !== i))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <div className="file-list-add" onClick={() => document.getElementById('en-files-input').click()}>
                      + Add more files
                    </div>
                  </div>
                ) : (
                  <div className="upload-box-hint">Click to select one or more PDF files</div>
                )}
              </div>

              <div
                className={`upload-box ${tamilFiles.length > 0 ? 'upload-box--has-files' : ''}`}
                onClick={() => document.getElementById('ta-files-input').click()}
              >
                <input
                  id="ta-files-input"
                  type="file"
                  accept=".pdf"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => setTamilFiles(Array.from(e.target.files || []))}
                />
                <div className="upload-box-icon">
                  <FileText size={32} />
                </div>
                <div className="upload-box-title">
                  {mode === 'replace' && replaceScope === 'specific' ? 'Replacement Tamil Case PDF' : 'Tamil Case PDF(s)'}
                </div>
                <div className="upload-box-desc">
                  {mode === 'replace' && replaceScope === 'specific'
                    ? 'Upload replacement judgment / petition in Tamil'
                    : 'Select one or multiple Tamil case documents'}
                </div>
                {tamilFiles.length > 0 ? (
                  <div className="file-list" onClick={(ev) => ev.stopPropagation()}>
                    {tamilFiles.map((f, i) => (
                      <div key={i} className="file-list-item">
                        <span className="file-list-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <FileText size={12} />
                          {f.name}
                        </span>
                        <span className="file-list-size">({(f.size / 1024 / 1024).toFixed(2)} MB)</span>
                        <button
                          type="button"
                          className="file-list-remove"
                          onClick={() => setTamilFiles(prev => prev.filter((_, j) => j !== i))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <div className="file-list-add" onClick={() => document.getElementById('ta-files-input').click()}>
                      + Add more files
                    </div>
                  </div>
                ) : (
                  <div className="upload-box-hint">Click to select one or more PDF files</div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '12px' }}>
              <div className="upload-box" onClick={() => document.getElementById('case-zip-input').click()}>
                <input
                  id="case-zip-input"
                  type="file"
                  accept=".zip"
                  style={{ display: 'none' }}
                  onChange={(e) => setZipFile(e.target.files[0] || null)}
                />
                <div className="upload-box-icon">
                  <Archive size={32} />
                </div>
                <div className="upload-box-title">Bulk ZIP Archive containing Case PDFs</div>
                <div className="upload-box-desc">
                  Place PDFs in <strong>english/</strong> and <strong>tamil/</strong> subfolders inside the ZIP,
                  or name Tamil files with <em>_ta</em> or <em>ta_</em> in the filename (e.g. <em>case001_ta.pdf</em>).
                  All other PDFs are treated as English documents.
                </div>
                {zipFile && (
                  <div className="file-selected-badge">
                    <Check size={14} />
                    {zipFile.name} ({(zipFile.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="form-actions-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !hasLandRecordsForTaluk || !selectedVillage}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {busy ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  Indexing &amp; Fitting Model…
                </>
              ) : mode === 'replace' ? (
                <>
                  <RefreshCw size={14} />
                  Replace Case Documents &amp; Re-index
                </>
              ) : (
                <>
                  <UploadCloud size={14} />
                  Upload &amp; Index Case Documents
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={handleReload}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={13} />
              Force Re-index from Disk
            </button>
          </div>
        </form>

        {uploadResult && (
          <div style={{ marginTop: '16px', background: '#ecfdf5', padding: '14px 18px', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
            <strong style={{ color: '#065f46', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={16} />
              Live Index Result:
            </strong>
            <div style={{ display: 'flex', gap: '20px', marginTop: '6px', fontSize: '13.5px', color: '#047857' }}>
              <div><b>English Files Saved:</b> {uploadResult.english_saved}</div>
              <div><b>Tamil Files Saved:</b> {uploadResult.tamil_saved}</div>
              <div><b>Total Cases Now Active:</b> {uploadResult.total_cases_indexed}</div>
            </div>
          </div>
        )}
      </div>

      {/* Live Indexed Cases Browser */}
      <div className="card">
        <div className="card-head">
          <h3>Active Case Records in Retrieval Engine ({cases.length})</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Filter by survey no. (e.g. 71 or 57)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '240px', padding: '6px 10px', fontSize: '13px' }}
            />
            <button
              className="btn btn-sm btn-outline"
              onClick={() => loadSampleCases(searchQuery)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <Search size={13} />
              Search
            </button>
          </div>
        </div>

        {loadingCases ? (
          <div className="empty">Loading case records…</div>
        ) : cases.length === 0 ? (
          <div className="empty">No case records matched.</div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Survey No.</th>
                  <th>Subdivision</th>
                  <th>Village</th>
                  <th>Dispute Type</th>
                  <th>Status</th>
                  <th>Parties</th>
                  <th>Filing Date</th>
                </tr>
              </thead>
              <tbody>
                {cases.slice(0, 50).map((c) => (
                  <tr key={c.case_id}>
                    <td><strong>{c.case_id}</strong></td>
                    <td><b>{c.survey_no}</b></td>
                    <td>{c.subdivision || '—'}</td>
                    <td>{c.village || '—'}</td>
                    <td>
                      <span className="badge badge-purple">
                        {c.dispute_type?.english || 'Dispute'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${c.status?.english?.toLowerCase()?.includes('pend') ? 'badge-orange' : 'badge-green'}`}>
                        {c.status?.english || 'Active'}
                      </span>
                    </td>
                    <td style={{ fontSize: '12.5px', maxWidth: '240px' }}>
                      <span style={{ color: '#1e3a5f', fontWeight: 600 }}>{cleanTamilText(c.petitioner)}</span>
                      <br />
                      <span style={{ color: '#64748b' }}>vs {cleanTamilText(c.respondent)}</span>
                    </td>
                    <td>{c.filing_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cases.length > 50 && (
              <div style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
                Showing first 50 of {cases.length} indexed cases. Use the survey filter above to view others.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

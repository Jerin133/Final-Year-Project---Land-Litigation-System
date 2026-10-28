import { useEffect, useState, useMemo } from 'react'
import { caseApi, landApi, gisApi } from '../../lib/api.js'
import { normVillage, printReport, cleanTamilText } from '../../lib/util.js'
import { Card, Empty, ErrorBox, Badge } from '../../components/ui.jsx'
import CaseCard from './CaseCard.jsx'
import GisMap from '../../components/GisMap.jsx'
import { buildSurveyReport } from './report.js'
import { TN_DISTRICTS, getTaluksForDistrict } from '../../lib/tnLocations.js'
import { Search, FileText } from 'lucide-react'

export function LocationHierarchySelect({
  villages,
  district,
  taluk,
  village,
  onDistrictChange,
  onTalukChange,
  onVillageChange,
  disabled = false,
}) {
  const taluksList = getTaluksForDistrict(district)
  const filteredVillages = villages.filter((v) => {
    const matchDist = !district || (v.district || '').toLowerCase() === district.toLowerCase()
    const matchTaluk = !taluk || (v.taluk || '').toLowerCase() === taluk.toLowerCase()
    return matchDist && matchTaluk
  })

  return (
    <>
      <div className="hierarchy-select-grid">
        <label style={{ margin: 0 }}>
          District (Tamil Nadu)
          <select
            value={district}
            onChange={(e) => onDistrictChange(e.target.value)}
            disabled={disabled}
            style={{ height: '42px', fontWeight: district ? 600 : 400 }}
          >
            <option value="">-- Choose District --</option>
            {TN_DISTRICTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>

        <label style={{ margin: 0 }}>
          Taluk ({district || 'Tamil Nadu'})
          <select
            value={taluk}
            onChange={(e) => onTalukChange(e.target.value)}
            disabled={disabled || !district}
            style={{ height: '42px', fontWeight: taluk ? 600 : 400 }}
          >
            <option value="">{district ? '-- Choose Taluk --' : '-- Choose District first --'}</option>
            {taluksList.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <label style={{ margin: 0 }}>
          Village
          <select
            value={village}
            onChange={(e) => onVillageChange(e.target.value)}
            disabled={disabled || !taluk || filteredVillages.length === 0}
            style={{ height: '42px', fontWeight: village ? 600 : 400 }}
          >
            {!district ? (
              <option value="">-- Choose District first --</option>
            ) : !taluk ? (
              <option value="">-- Choose Taluk first --</option>
            ) : filteredVillages.length === 0 ? (
              <option value="">-- No registered villages in this taluk --</option>
            ) : (
              <>
                <option value="">-- Choose Village ({filteredVillages.length} available) --</option>
                {filteredVillages.map((v) => (
                  <option key={v.village} value={v.village}>
                    {v.village}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
      </div>

      {taluk && filteredVillages.length === 0 && (
        <div style={{
          marginBottom: '14px',
          fontSize: '12.5px',
          color: '#92400e',
          background: '#fffbeb',
          padding: '8px 14px',
          borderRadius: '8px',
          border: '1px solid #fef3c7',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>ℹ️</span>
          <span>
            No registered land records under <b>{taluk}, {district}</b> yet.
            {villages.length > 0 && (
              <> Currently available: <b>{villages.map(v => v.village).join(', ')}</b> in <b>Harur, Dharmapuri</b>.</>
            )}
          </span>
        </div>
      )}
    </>
  )
}

export function VillageSelect({ villages, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {villages.length === 0 && <option value="">(no villages loaded)</option>}
      {villages.map((v) => <option key={v.village} value={v.village}>{v.village} — {v.taluk}, {v.district}</option>)}
    </select>
  )
}

function LandRecord({ land, mode = 'survey' }) {
  if (!land) return null
  const isPatta = mode === 'patta'
  if (!land.found) {
    return (
      <Empty>
        No land record found for {isPatta ? `Patta No. ${land.patta_number}` : `Survey ${land.survey_number}`} in {land.village}.
      </Empty>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '14px' }}>
        <p className="muted" style={{ margin: 0 }}>
          {land.village} · {land.taluk} taluk · {land.district} district
          {land.survey_total && (
            <> · total extent <b>{land.survey_total.total_area_hectare} Ha {land.survey_total.total_area_are} Ar</b> · total tax <b>Rs. {land.survey_total.total_tax_rs}.{land.survey_total.total_tax_paise || '00'}</b></>
          )}
          {isPatta && land.patta_number && (
            <> · Patta No. <b>{land.patta_number}</b></>
          )}
        </p>
        {isPatta && land.survey_numbers && land.survey_numbers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="muted small" style={{ fontWeight: 600 }}>Linked Survey Numbers:</span>
            {land.survey_numbers.map((sn) => (
              <Badge key={sn} tone="purple">Survey {sn}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Pattas Section */}
      {land.pattas && land.pattas.map((p) => (
        <div key={p.patta_number} className="patta-card" style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '16px', marginBottom: '18px', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', borderBottom: '1px solid #edf2f7', paddingBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '16px', color: 'var(--navy)' }}>Patta No. {p.patta_number}</h4>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Badge tone="blue">{p.owners?.length || 0} Owner{p.owners?.length === 1 ? '' : 's'}</Badge>
              <Badge tone="gray">{p.extents?.length || 0} Extent Record{p.extents?.length === 1 ? '' : 's'}</Badge>
            </div>
          </div>

          {/* Owners Table */}
          <div style={{ marginBottom: '16px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '13.5px', color: '#475467', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Owners (பட்டாதாரர்கள் விவரம்)
            </h5>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '48px' }}>#</th>
                    <th>Owner Name (பட்டாதாரர் பெயர்)</th>
                    <th>Relative Name (உறவினர் பெயர்)</th>
                    <th>Relationship (உறவுமுறை)</th>
                  </tr>
                </thead>
                <tbody>
                  {p.owners && p.owners.length > 0 ? (
                    p.owners.map((o, i) => (
                      <tr key={i}>
                        <td><b>{o.seq_no || (i + 1)}</b></td>
                        <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{cleanTamilText(o.owner_name) || '—'}</td>
                        <td>{cleanTamilText(o.relative_name) || '—'}</td>
                        <td>{o.relation ? <span className="badge badge-gray">{cleanTamilText(o.relation)}</span> : '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={4} className="muted center">No owner records listed.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Extents (Chitta) Table */}
          {p.extents && p.extents.length > 0 && (
            <div>
              <h5 style={{ margin: '0 0 8px 0', fontSize: '13.5px', color: '#475467', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Land Extent — Chitta (சிட்டா நில விவரங்கள்)
              </h5>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Survey / Sub-div. (சர்வே/உட்பிரிவு)</th>
                      <th>Nanjai / Wet Land (நஞ்சை பரப்பு / தீர்வை)</th>
                      <th>Punjai / Dry Land (புஞ்சை பரப்பு / தீர்வை)</th>
                      <th>Other Land (மற்றவை)</th>
                      <th>Remarks (குறிப்பு)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.extents.map((e, idx) => {
                      const isTot = Boolean(e.is_total_row)
                      const label = isTot ? (
                        <b style={{ color: 'var(--navy)' }}>TOTAL (மொத்தம்)</b>
                      ) : (
                        e.survey_subdivision_raw || (e.survey_number ? `${e.survey_number}-${e.sub_division || ''}` : '—')
                      )
                      return (
                        <tr key={idx} style={isTot ? { background: '#f8fafc', fontWeight: 600 } : {}}>
                          <td>{label}</td>
                          <td>{e.nanjai_area || '0 - 0.00'} ac · Rs. {e.nanjai_tax || '0.00'}</td>
                          <td>{e.punjai_area || '0 - 0.00'} ac · Rs. {e.punjai_tax || '0.00'}</td>
                          <td>{e.other_area || '0 - 0.00'} ac · Rs. {e.other_tax || '0.00'}</td>
                          <td>{e.remarks && e.remarks !== '-' ? <span className="badge badge-orange">{cleanTamilText(e.remarks)}</span> : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* A-Register Land Classification Table */}
      {land.classification && land.classification.length > 0 && (
        <div className="sub-block" style={{ marginTop: '20px', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #edf2f7', paddingBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--navy)' }}>
              Land Classification — A-Register (அ-பதிவேடு நில வகைப்பாடு)
            </h4>
            <Badge tone="blue">{land.classification.length} Sub-division record{land.classification.length === 1 ? '' : 's'}</Badge>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isPatta && <th>Survey No.</th>}
                  <th>Sub-div.</th>
                  <th>Old Survey No.</th>
                  <th>Tenure</th>
                  <th>Land Use</th>
                  <th>Irrigation</th>
                  <th>Double Crop</th>
                  <th>Soil (Code/Grade)</th>
                  <th>Tax Rate</th>
                  <th>Area (Extent)</th>
                  <th>Total Tax</th>
                </tr>
              </thead>
              <tbody>
                {land.classification.map((c, i) => (
                  <tr key={i}>
                    {isPatta && <td><b>{c.survey_number || '—'}</b></td>}
                    <td><b>{c.sub_division || '—'}</b></td>
                    <td>{c.old_survey_subdivision || '—'}</td>
                    <td>
                      <span className={`badge ${c.tenure_type?.includes('அரசு') || c.tenure_flag === '' ? 'badge-orange' : 'badge-green'}`}>
                        {cleanTamilText(c.tenure_type) || (c.tenure_flag === 'P' ? 'ரயத்துவாரி' : 'அரசு')}
                      </span>
                    </td>
                    <td>{cleanTamilText(c.land_use) || '—'}</td>
                    <td>{cleanTamilText(c.irrigation_source) || '—'}</td>
                    <td>{c.double_crop || '—'}</td>
                    <td>{c.soil_type_code || '—'}{c.soil_grade ? ` / ${c.soil_grade}` : ''}</td>
                    <td>{c.tax_rate_rs ? `Rs. ${c.tax_rate_rs}.${c.tax_rate_paise || '00'}` : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{c.area_hectare || '0'} Ha {c.area_are || '0.00'} Ar</td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{c.total_tax_rs ? `Rs. ${c.total_tax_rs}.${c.total_tax_paise || '00'}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Survey Totals (when searching by patta with multiple survey numbers) */}
          {land.survey_totals && land.survey_totals.length > 0 && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '13px' }}>
              <span style={{ fontWeight: 700, color: 'var(--navy)' }}>Survey Totals:</span>
              {land.survey_totals.map((t) => (
                <span key={t.survey_number}>
                  Survey <b>{t.survey_number}</b>: <b>{t.total_area_hectare} Ha {t.total_area_are} Ar</b> (Tax: Rs. {t.total_tax_rs}.{t.total_tax_paise || '00'})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* GIS Boundary Coordinate Info */}
      <div style={{ marginTop: '12px', padding: '8px 12px', background: '#f8fafc', borderRadius: '6px' }}>
        <p className="muted small" style={{ margin: 0 }}>
          <b>GIS boundary:</b> {land.gis ? (
            <span>{land.gis.source} {land.gis.geometry_wkt ? `— ${land.gis.geometry_wkt}` : ''}</span>
          ) : (
            'Not available in the current text records (geometry is populated via FMB sketches or DILRMP shapefiles).'
          )}
        </p>
      </div>
    </>
  )
}

export default function SurveySearch({ villages, lang, setLang, trackedIds, onTrack, onUntrack, search, setSearch }) {
  const [searchMode, setSearchMode] = useState('survey') // 'survey' | 'patta'
  const [district, setDistrict] = useState(search.district || '')
  const [taluk, setTaluk] = useState(search.taluk || '')
  const [village, setVillage] = useState(search.village || '')
  const [survey, setSurvey] = useState(search.survey || '')
  const [patta, setPatta] = useState(search.patta || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const casesBySurvey = useMemo(() => {
    if (!result?.cases?.length) return {}
    const map = {}
    for (const c of result.cases) {
      const s = String(c.survey_number || result.survey || '').trim()
      if (!map[s]) map[s] = { total: 0, band: 'Low' }
      map[s].total += 1
    }
    for (const k of Object.keys(map)) {
      if (map[k].total >= 3) map[k].band = 'High'
      else if (map[k].total >= 1) map[k].band = 'Medium'
    }
    return map
  }, [result])

  // Restore from a previous search if the user navigated away and back
  useEffect(() => {
    if (villages.length > 0 && search.village && !district) {
      const found = villages.find((v) => normVillage(v.village) === normVillage(search.village))
      if (found) {
        setDistrict(found.district || '')
        setTaluk(found.taluk || '')
        setVillage(found.village)
      }
    }
  }, [villages, search.village]) // eslint-disable-line

  function handleDistrictChange(newDist) {
    setDistrict(newDist)
    setTaluk('')
    setVillage('')
    setResult(null)
  }

  function handleTalukChange(newTaluk) {
    setTaluk(newTaluk)
    const matches = villages.filter(
      (v) => (v.district || '').toLowerCase() === district.toLowerCase() && (v.taluk || '').toLowerCase() === newTaluk.toLowerCase()
    )
    if (matches.length === 1) {
      setVillage(matches[0].village)
    } else {
      setVillage('')
    }
    setResult(null)
  }

  function handleVillageChange(newVillage) {
    setVillage(newVillage)
    setResult(null)
  }

  async function run(e) {
    e?.preventDefault()
    if (!village) return
    const isPatta = searchMode === 'patta'
    const targetVal = isPatta ? patta.trim() : survey.trim()
    if (!targetVal) return

    setBusy(true)
    setError(null)
    setResult(null)

    try {
      if (isPatta) {
        // Search by Patta Number
        const landRes = await landApi.patta(village, targetVal)
        let land = landRes
        let landError = null

        // In patta search, court cases are queried for all survey numbers covered by the patta
        let cases = []
        let caseError = null
        const linkedSurveys = land.survey_numbers || []

        if (linkedSurveys.length > 0) {
          const casePromises = linkedSurveys.map((sn) =>
            caseApi.survey(sn).catch((err) => (err?.status === 404 ? { cases: [] } : Promise.reject(err)))
          )
          const settled = await Promise.allSettled(casePromises)
          const seen = new Set()
          for (const s of settled) {
            if (s.status === 'fulfilled' && s.value?.cases) {
              for (const c of s.value.cases) {
                if (!c.village || normVillage(c.village) === normVillage(village)) {
                  if (!seen.has(c.case_id)) {
                    seen.add(c.case_id)
                    cases.push(c)
                  }
                }
              }
            } else if (s.status === 'rejected' && s.reason?.status !== 404) {
              caseError = s.reason
            }
          }
        }

        let risk = {}
        if (cases.length) {
          try {
            risk = (await caseApi.riskBatch(cases.map((c) => c.case_id))).predictions
          } catch {
            /* risk is optional */
          }
        }

        // Show land & court case results immediately (<1s) while GIS loads progressively
        setResult({
          mode: 'patta',
          village,
          patta: targetVal,
          land,
          landError,
          caseError,
          cases,
          risk,
          gisFeature: null,
          gisFeatures: [],
          gisVillageCollection: null,
          gisLoading: linkedSurveys.length > 0,
        })
        setSearch({ district, taluk, village, patta: targetVal, survey: linkedSurveys[0] || '' })
        setBusy(false)

        // Query GIS cadastral polygons & full village collection asynchronously in background
        if (linkedSurveys && linkedSurveys.length > 0) {
          ;(async () => {
            try {
              const vList = await gisApi.villages().catch(() => [])
              const matchedV = vList.find((v) => v.name?.toLowerCase() === village.toLowerCase() || v.slug === village.toLowerCase())
              const vSlug = matchedV ? matchedV.slug : undefined

              const [polyRes, ...surveyResults] = await Promise.allSettled([
                gisApi.polygons(vSlug),
                ...linkedSurveys.map((sNo) => gisApi.search(sNo, vSlug)),
              ])

              let gisVillageCollection = null
              let gisFeatures = []
              let gisFeature = null

              if (polyRes.status === 'fulfilled' && polyRes.value?.type === 'FeatureCollection') {
                gisVillageCollection = polyRes.value
              }

              for (const r of surveyResults) {
                if (r.status === 'fulfilled' && r.value?.type === 'Feature') {
                  gisFeatures.push(r.value)
                }
              }
              if (gisFeatures.length === 1) {
                gisFeature = gisFeatures[0]
              } else if (gisFeatures.length > 1) {
                gisFeature = gisFeatures
              }

              setResult((prev) => {
                if (!prev || prev.patta !== targetVal || prev.village !== village) return prev
                return { ...prev, gisFeature, gisFeatures, gisVillageCollection, gisLoading: false }
              })
            } catch {
              setResult((prev) => (prev ? { ...prev, gisLoading: false } : prev))
            }
          })()
        }
      } else {
        // Search by Survey Number
        const [landRes, caseRes] = await Promise.allSettled([landApi.land(village, targetVal), caseApi.survey(targetVal)])
        let land = landRes.status === 'fulfilled' ? landRes.value : null
        let landError = landRes.status === 'rejected' ? landRes.reason : null
        let cases = []
        let caseError = null
        if (caseRes.status === 'fulfilled') {
          cases = caseRes.value.cases.filter((c) => !c.village || normVillage(c.village) === normVillage(village))
        } else if (caseRes.reason?.status !== 404) {
          caseError = caseRes.reason
        }
        let risk = {}
        if (cases.length) {
          try {
            risk = (await caseApi.riskBatch(cases.map((c) => c.case_id))).predictions
          } catch {
            /* risk is optional */
          }
        }

        // Show land & court case results immediately (<1s) while GIS loads progressively
        setResult({
          mode: 'survey',
          village,
          survey: targetVal,
          land,
          landError,
          caseError,
          cases,
          risk,
          gisFeature: null,
          gisFeatures: [],
          gisVillageCollection: null,
          gisLoading: true,
        })
        setSearch({ district, taluk, village, survey: targetVal, patta: '' })
        setBusy(false)

        // Query GIS cadastral polygon & full village collection asynchronously in background
        ;(async () => {
          try {
            const vList = await gisApi.villages().catch(() => [])
            const matchedV = vList.find((v) => v.name?.toLowerCase() === village.toLowerCase() || v.slug === village.toLowerCase())
            const vSlug = matchedV ? matchedV.slug : undefined
            const [fRes, polyRes] = await Promise.allSettled([
              gisApi.search(targetVal, vSlug),
              gisApi.polygons(vSlug),
            ])
            let gisFeature = null
            let gisFeatures = []
            let gisVillageCollection = null
            if (fRes.status === 'fulfilled' && fRes.value?.type === 'Feature') {
              gisFeature = fRes.value
              gisFeatures = [fRes.value]
            }
            if (polyRes.status === 'fulfilled' && polyRes.value?.type === 'FeatureCollection') {
              gisVillageCollection = polyRes.value
            }

            setResult((prev) => {
              if (!prev || prev.survey !== targetVal || prev.village !== village) return prev
              return { ...prev, gisFeature, gisFeatures, gisVillageCollection, gisLoading: false }
            })
          } catch {
            setResult((prev) => (prev ? { ...prev, gisLoading: false } : prev))
          }
        })()
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const report = () => {
    if (!result) return
    const isPatta = result.mode === 'patta'
    const reportTitle = isPatta ? `Report - Patta ${result.patta}` : `Report - Survey ${result.survey}`
    printReport(
      reportTitle,
      buildSurveyReport({
        mode: result.mode,
        village: result.village,
        survey: result.survey,
        patta: result.patta,
        land: result.land,
        cases: result.cases,
        risk: result.risk,
        lang,
      })
    )
  }

  return (
    <>
      <Card title={searchMode === 'patta' ? 'Search by Patta Number' : 'Search by Survey Number'}>
        {/* Search Mode Toggle Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            className={`btn btn-sm ${searchMode === 'survey' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setSearchMode('survey'); setResult(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            <Search size={14} />
            Search by Survey No.
          </button>
          <button
            type="button"
            className={`btn btn-sm ${searchMode === 'patta' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => { setSearchMode('patta'); setResult(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            <FileText size={14} />
            Search by Patta No.
          </button>
        </div>

        <form onSubmit={run}>
          {/* Location Hierarchy: District -> Taluk -> Village */}
          <LocationHierarchySelect
            villages={villages}
            district={district}
            taluk={taluk}
            village={village}
            onDistrictChange={handleDistrictChange}
            onTalukChange={handleTalukChange}
            onVillageChange={handleVillageChange}
            disabled={busy}
          />

          <div className="survey-search-row">
            {searchMode === 'survey' ? (
              <label style={{ margin: 0 }}>
                Survey number
                <input
                  value={survey}
                  onChange={(e) => setSurvey(e.target.value)}
                  placeholder="e.g. 78 or 108"
                  inputMode="numeric"
                  disabled={!village || busy}
                  style={{ height: '42px' }}
                />
              </label>
            ) : (
              <label style={{ margin: 0 }}>
                Patta number
                <input
                  value={patta}
                  onChange={(e) => setPatta(e.target.value)}
                  placeholder="e.g. 46 or 60"
                  inputMode="numeric"
                  disabled={!village || busy}
                  style={{ height: '42px' }}
                />
              </label>
            )}
            <button
              className="btn btn-primary"
              style={{ height: '42px', fontWeight: 600 }}
              disabled={busy || !village || (searchMode === 'survey' ? !survey.trim() : !patta.trim())}
            >
              {busy ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>
      </Card>

      <ErrorBox error={error} />

      {result && (
        <>
          <Card
            title={result.mode === 'patta' ? `Patta No. ${result.patta} · ${result.village}` : `Survey ${result.survey} · ${result.village}`}
            right={<button className="btn btn-outline btn-sm" onClick={report}>⬇ Download report</button>}
          >
            <div className="badges">
              <Badge tone={result.land?.found ? 'green' : 'gray'}>
                {result.land?.found ? 'Land record found' : 'No land record'}
              </Badge>
              <Badge tone={result.cases.length ? 'orange' : 'green'}>
                {result.cases.length} court case{result.cases.length === 1 ? '' : 's'}
              </Badge>
              <Badge tone={result.gisFeature ? 'blue' : 'gray'}>
                {result.gisFeature ? 'GIS Cadastral Digitized' : 'No GIS Boundary'}
              </Badge>
              {result.mode === 'patta' && result.land?.survey_numbers?.length > 0 && (
                <Badge tone="purple">{result.land.survey_numbers.length} linked survey(s)</Badge>
              )}
            </div>
            {result.landError && <div className="alert alert-warn">Land records unavailable: {result.landError.message}</div>}
            {result.caseError && <div className="alert alert-warn">Court-case data unavailable: {result.caseError.message}</div>}
          </Card>

          {/* GIS Cadastral Parcel Map Card */}
          <Card
            title="Cadastral Map & Parcel Boundaries"
            right={
              result.gisLoading ? (
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Loading boundary map…
                </span>
              ) : result.gisFeature ? (
                <span style={{ fontSize: '12px', color: '#0d9488', fontWeight: 600 }}>
                  WGS84 EPSG:4326 · Verified Boundary {Array.isArray(result.gisFeature) ? `(${result.gisFeature.length} Linked Parcels)` : ''}
                </span>
              ) : null
            }
          >
            {result.gisLoading ? (
              <div style={{ padding: '28px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', color: '#64748b' }}>
                <div style={{ fontSize: '13.5px', color: '#475569', fontWeight: 500 }}>
                  Fetching cadastral map &amp; polygon boundary…
                </div>
              </div>
            ) : result.gisFeature || result.gisVillageCollection ? (
              <div>
                <GisMap
                  featureCollection={result.gisVillageCollection}
                  highlightFeature={result.gisFeature}
                  casesBySurvey={casesBySurvey}
                  height="420px"
                  showLabels={true}
                />
                {(() => {
                  const feats = Array.isArray(result.gisFeature)
                    ? result.gisFeature
                    : (result.gisFeatures && result.gisFeatures.length)
                    ? result.gisFeatures
                    : result.gisFeature ? [result.gisFeature] : []
                  const totalArea = feats.reduce((acc, f) => acc + (Number(f.properties?.area_sqm) || 0), 0)
                  const firstFeat = feats[0]

                  return (
                    <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                      <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Cadastral Ground Area</div>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--navy)' }}>
                          {totalArea ? totalArea.toLocaleString('en-IN') + ' m²' : '—'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          ≈ {totalArea ? (totalArea / 10000).toFixed(4) + ' Hectares' : '—'}
                          {feats.length > 1 ? ` (${feats.length} Parcels)` : ''}
                        </div>
                      </div>
                      <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Centroid Coordinates</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--navy)' }}>
                          {firstFeat?.properties?.centroid_lat
                            ? `${firstFeat.properties.centroid_lat.toFixed(5)}, ${firstFeat.properties.centroid_lng.toFixed(5)}`
                            : '—'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {feats.length > 1
                            ? `Parcels: Survey ${feats.map(f => f.properties?.survey_no).filter(Boolean).join(', ')}`
                            : 'WGS84 Geographic Reference'}
                        </div>
                      </div>
                      <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Litigation Status on Parcel</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: result.cases?.length ? '#dc2626' : '#16a34a' }}>
                          {result.cases?.length ? `${result.cases.length} Case(s) Enclosed` : 'Clear Boundary · 0 Disputes'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          Cross-referenced with Registry
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            ) : (
              <div style={{ padding: '18px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                <p style={{ margin: 0, fontSize: '13.5px' }}>
                  No digital GIS parcel boundary found for Survey <b>{result.survey || result.patta}</b> in <b>{result.village}</b>.
                </p>
                <span style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                  Cadastral boundaries can be uploaded by the administration via the Admin Console.
                </span>
              </div>
            )}
          </Card>

          <Card title="Land record">
            <LandRecord land={result.land} mode={result.mode} />
          </Card>

          <Card
            title={`Court cases (${result.cases.length})`}
            right={
              setLang && (
                <div className="seg" style={{ fontSize: '13px' }}>
                  <button
                    type="button"
                    className={lang === 'en' ? 'on' : ''}
                    onClick={() => setLang('en')}
                    style={{ padding: '5px 12px' }}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    className={lang === 'ta' ? 'on' : ''}
                    onClick={() => setLang('ta')}
                    style={{ padding: '5px 12px' }}
                  >
                    தமிழ்
                  </button>
                </div>
              )
            }
          >
            {result.cases.length === 0 ? (
              <Empty>No court case is on record for this {result.mode === 'patta' ? 'patta' : 'survey number'}.</Empty>
            ) : (
              result.cases.map((c) => (
                <CaseCard
                  key={c.case_id}
                  c={c}
                  risk={result.risk[c.case_id]}
                  lang={lang}
                  tracked={trackedIds.has(c.case_id)}
                  onTrack={onTrack}
                  onUntrack={onUntrack}
                />
              ))
            )}
          </Card>
        </>
      )}
    </>
  )
}

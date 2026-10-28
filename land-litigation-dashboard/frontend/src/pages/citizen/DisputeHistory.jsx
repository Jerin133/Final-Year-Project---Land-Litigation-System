import { useEffect, useState } from 'react'
import { caseApi } from '../../lib/api.js'
import { fmtDate, normVillage, parseDate, countBy, cleanTamilText } from '../../lib/util.js'
import { Card, Empty, ErrorBox, Badge, statusTone, Stat } from '../../components/ui.jsx'
import { LocationHierarchySelect } from './SurveySearch.jsx'
import { pick } from './CaseCard.jsx'

export default function DisputeHistory({ villages, lang, setLang, search, setSearch }) {
  const [district, setDistrict] = useState(search.district || '')
  const [taluk, setTaluk] = useState(search.taluk || '')
  const [village, setVillage] = useState(search.village || '')
  const [survey, setSurvey] = useState(search.survey || '')
  const [cases, setCases] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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
    setCases(null)
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
    setCases(null)
  }

  function handleVillageChange(newVillage) {
    setVillage(newVillage)
    setCases(null)
  }

  async function run(e) {
    e?.preventDefault()
    if (!village || !survey.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await caseApi.survey(survey.trim())
      const list = res.cases.filter((c) => !c.village || normVillage(c.village) === normVillage(village))
      list.sort((a, b) => (parseDate(a.filing_date) || 0) - (parseDate(b.filing_date) || 0))
      setCases(list)
      setSearch({ district, taluk, village, survey: survey.trim() })
    } catch (err) {
      if (err.status === 404) setCases([])
      else { setError(err); setCases(null) }
    } finally {
      setBusy(false)
    }
  }

  // run automatically when arriving from a previous search
  useEffect(() => { if (search.survey && village && cases === null) run() }, [village]) // eslint-disable-line

  const types = cases ? [...countBy(cases, (c) => c.dispute_type?.english)] : []
  const open = cases ? cases.filter((c) => c.status?.english !== 'Disposed').length : 0

  return (
    <>
      <Card title="Dispute history of a survey number">
        <form onSubmit={run}>
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
            <label style={{ margin: 0 }}>
              Survey number
              <input
                value={survey}
                onChange={(e) => setSurvey(e.target.value)}
                placeholder="e.g. 78 or 108"
                style={{ height: '42px' }}
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || !village || !survey.trim()}
              style={{ height: '42px', fontWeight: 600 }}
            >
              {busy ? 'Loading…' : 'View history'}
            </button>
          </div>
        </form>
      </Card>
      <ErrorBox error={error} />
      {cases && cases.length === 0 && <Card><Empty>No dispute has ever been recorded for survey {survey}.</Empty></Card>}
      {cases && cases.length > 0 && (
        <>
          <div className="stats">
            <Stat label="Total disputes" value={cases.length} />
            <Stat label="Still open" value={open} tone={open ? 'warn' : ''} />
            <Stat label="Resolved" value={cases.length - open} tone="ok" />
            <Stat label="Dispute types" value={types.map(([k, v]) => `${k} ×${v}`).join(', ') || '—'} />
          </div>
          <Card
            title="Timeline (oldest first)"
            right={
              setLang && (
                <div className="seg" style={{ fontSize: '13px' }}>
                  <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} style={{ padding: '5px 12px' }}>English</button>
                  <button type="button" className={lang === 'ta' ? 'on' : ''} onClick={() => setLang('ta')} style={{ padding: '5px 12px' }}>தமிழ்</button>
                </div>
              )
            }
          >
            <ol className="timeline">
              {cases.map((c) => (
                <li key={c.case_id}>
                  <div className="t-date">{fmtDate(c.filing_date)}</div>
                  <div className="t-body">
                    <b>{c.case_id}</b> · sub-division {c.subdivision || '—'}
                    <div className="badges">
                      <Badge tone="purple">{pick(c.dispute_type, lang)}</Badge>
                      <Badge tone={statusTone(c.status?.english)}>{pick(c.status, lang)}</Badge>
                    </div>
                    <p className="muted small">
                      {cleanTamilText(c.petitioner)} vs {cleanTamilText(c.respondent)} · {c.hearing_count ?? 0} hearings, {c.adjournment_count ?? 0} adjournments
                      {c.disposal_date ? ` · disposed ${fmtDate(c.disposal_date)}` : ' · still pending'}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { caseApi } from '../../lib/api.js'
import { fmtDate } from '../../lib/util.js'
import { Card, Empty, ErrorBox, Badge, statusTone } from '../../components/ui.jsx'
import { pick, RiskLine } from './CaseCard.jsx'

export default function Hearings({ tracked, lang, setLang, onUntrack, goSearch }) {
  const [rows, setRows] = useState([])
  const [risk, setRisk] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [updated, setUpdated] = useState(null)

  const key = tracked.map((t) => t.case_id).join(',')
  const load = useCallback(async () => {
    if (!tracked.length) { setRows([]); return }
    setBusy(true)
    setError(null)
    try {
      const res = await Promise.allSettled(tracked.map((t) => caseApi.case(t.case_id)))
      setRows(res.filter((r) => r.status === 'fulfilled').map((r) => r.value))
      if (res.some((r) => r.status === 'rejected')) setError(new Error('Some cases could not be refreshed.'))
      try { setRisk((await caseApi.riskBatch(tracked.map((t) => t.case_id))).predictions) } catch { /* optional */ }
      setUpdated(new Date())
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { load() }, [load])

  return (
    <>
      <Card title="Hearings of cases you track"
        right={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {setLang && (
              <div className="seg" style={{ fontSize: '13px' }}>
                <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} style={{ padding: '5px 12px' }}>English</button>
                <button type="button" className={lang === 'ta' ? 'on' : ''} onClick={() => setLang('ta')} style={{ padding: '5px 12px' }}>தமிழ்</button>
              </div>
            )}
            <button className="btn btn-outline btn-sm" onClick={load} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh'}</button>
          </div>
        }>
        <p className="muted small">
          Hearing progress comes from the case documents (number of hearings and adjournments recorded).
          Individual future hearing dates are not published in these documents, so you will be notified
          whenever a new hearing, adjournment or status change is recorded.
          {updated && <> Last refreshed {updated.toLocaleTimeString('en-IN')}.</>}
        </p>
        <ErrorBox error={error} />
      </Card>
      {tracked.length === 0 && (
        <Card><Empty>You are not tracking any case yet. <button className="link" onClick={goSearch}>Search a survey number</button> and press “Track this case”.</Empty></Card>
      )}
      {rows.map((c) => {
        const held = c.hearing_count ?? 0
        const adj = c.adjournment_count ?? 0
        const pct = held ? Math.round(((held - adj) / held) * 100) : 0
        return (
          <Card key={c.case_id} title={`${c.case_id} · Survey ${c.survey_no}${c.subdivision ? '/' + c.subdivision : ''}`}
            right={<button className="btn btn-sm btn-danger-outline" onClick={() => onUntrack(c.case_id)}>Stop tracking</button>}>
            <div className="badges">
              <Badge tone={statusTone(c.status?.english)}>{pick(c.status, lang)}</Badge>
              <Badge tone="purple">{pick(c.dispute_type, lang)}</Badge>
              {c.appeal_indicator && <Badge tone="orange">Appeal filed</Badge>}
            </div>
            <div className="hearing-grid">
              <div className="big"><b>{held}</b><span>hearings held</span></div>
              <div className="big"><b>{adj}</b><span>adjournments</span></div>
              <div className="big"><b>{pct}%</b><span>hearings that progressed</span></div>
              <div className="big"><b>{fmtDate(c.filing_date)}</b><span>filed</span></div>
            </div>
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            <div className="risk-line"><RiskLine r={risk[c.case_id]} /></div>
          </Card>
        )
      })}
    </>
  )
}

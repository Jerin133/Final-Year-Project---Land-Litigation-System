import { useMemo } from 'react'
import { Card, Stat, Badge, bandTone, Empty } from '../../components/ui.jsx'
import { BarBox, PieBox, BAND_COLORS } from './charts.jsx'
import { countBy, fmtDate, downloadCsv } from '../../lib/util.js'

const BUCKETS = [['< 1 year', 0, 365], ['1–2 years', 365, 730], ['2–3 years', 730, 1095], ['3–5 years', 1095, 1825], ['5+ years', 1825, Infinity]]
const toRows = (m) => [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

export default function Pending({ cases, riskOffline }) {
  const open = useMemo(() => cases.filter((c) => c.open), [cases])
  const appeal = open.filter((c) => c.status?.english === 'Appeal Pending').length
  const prolonged = open.filter((c) => c.risk?.already_prolonged).length
  const high = open.filter((c) => c.risk?.risk_band === 'High').length
  const ages = open.map((c) => c.ageDays).filter((x) => x != null)
  const median = ages.length ? [...ages].sort((a, b) => a - b)[Math.floor(ages.length / 2)] : null

  const ageData = BUCKETS.map(([name, lo, hi]) => ({ name, Cases: open.filter((c) => c.ageDays != null && c.ageDays >= lo && c.ageDays < hi).length }))
  const bands = toRows(countBy(open, (c) => c.risk?.risk_band || 'Unknown'))
  const byType = toRows(countBy(open, (c) => c.dispute_type?.english))
  const byCourt = toRows(countBy(open, (c) => c.court))
  const projected = useMemo(() => {
    const m = countBy(open.filter((c) => c.risk?.expected_completion?.expected_date), (c) => c.risk.expected_completion.expected_date.slice(0, 4))
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([year, n]) => ({ year, 'Expected disposals': n }))
  }, [open])
  const worst = useMemo(() => [...open].filter((c) => c.risk?.risk_score != null).sort((a, b) => b.risk.risk_score - a.risk.risk_score).slice(0, 15), [open])

  return (
    <>
      {riskOffline && <div className="alert alert-warn">Risk models are unavailable (is the Case Intelligence service fully started?). Age and status analytics still work; risk bands and projections are hidden.</div>}
      <div className="stats">
        <Stat label="Pending cases" value={open.length} tone="warn" />
        <Stat label="Appeal pending" value={appeal} />
        <Stat label="Older than 3 years" value={prolonged} tone="bad" />
        <Stat label="High-risk" value={high} tone="bad" />
        <Stat label="Median age" value={median != null ? `${(median / 365.25).toFixed(1)} yrs` : '—'} />
      </div>
      <div className="grid-2">
        <Card title="Pending cases by age"><BarBox data={ageData} xKey="name" bars={[{ key: 'Cases', color: '#1e3a5f' }]} /></Card>
        <Card title="Pending cases by risk band"><PieBox data={bands} colors={BAND_COLORS} /></Card>
      </div>
      <div className="grid-2">
        <Card title="Pending by dispute type"><BarBox data={byType} xKey="name" bars={[{ key: 'value', name: 'Cases', color: '#8e44ad' }]} horizontal height={280} /></Card>
        <Card title="Pending by court"><BarBox data={byCourt} xKey="name" bars={[{ key: 'value', name: 'Cases', color: '#2e86de' }]} horizontal height={280} /></Card>
      </div>
      <Card title="Projected disposals by year (model estimate)">
        {projected.length ? <BarBox data={projected} xKey="year" bars={[{ key: 'Expected disposals', color: '#2a9d8f' }]} height={260} /> : <Empty>No projections available.</Empty>}
        <p className="muted small">Median expected completion date of each pending case from the Weibull survival model. With a small case history these are indicative planning figures, not forecasts.</p>
      </Card>
      <Card title="Highest-risk pending cases" right={
        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv('pending_cases.csv', [
          ['Case ID', 'Village', 'Survey', 'Sub-division', 'Dispute', 'Status', 'Filed', 'Age (days)', 'Risk score', 'Risk band', 'Expected completion', 'Appeal probability'],
          ...open.map((c) => [c.case_id, c.village, c.survey_no, c.subdivision, c.dispute_type?.english, c.status?.english, c.filing_date, c.ageDays ?? '',
            c.risk?.risk_score ?? '', c.risk?.risk_band ?? '', c.risk?.expected_completion?.expected_date ?? '', c.risk?.appeal_probability ?? '']),
        ])}>⬇ All pending CSV</button>}>
        <div className="table-wrap"><table>
          <thead><tr><th>Case</th><th>Survey</th><th>Dispute</th><th>Filed</th><th>Age</th><th>Risk</th><th>Expected completion</th><th>Appeal chance</th></tr></thead>
          <tbody>{worst.map((c) => (
            <tr key={c.case_id}><td>{c.case_id}</td><td>{c.survey_no}/{c.subdivision}</td><td>{c.dispute_type?.english}</td><td>{fmtDate(c.filing_date)}</td>
              <td>{c.ageDays != null ? (c.ageDays / 365.25).toFixed(1) + ' y' : '—'}</td>
              <td><Badge tone={bandTone(c.risk.risk_band)}>{c.risk.risk_band} · {c.risk.risk_score}</Badge></td>
              <td>{c.risk.expected_completion?.expected_date || '—'}</td>
              <td>{c.risk.appeal_probability != null ? Math.round(c.risk.appeal_probability * 100) + '%' : '—'}</td></tr>
          ))}{!worst.length && <tr><td colSpan="8" className="muted">No scored pending cases.</td></tr>}</tbody>
        </table></div>
      </Card>
    </>
  )
}

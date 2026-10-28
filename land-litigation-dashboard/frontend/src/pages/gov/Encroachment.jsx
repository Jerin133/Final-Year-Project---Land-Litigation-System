import { useMemo } from 'react'
import { Card, Stat, Badge, statusTone, bandTone } from '../../components/ui.jsx'
import { BarBox, PieBox, LineBox } from './charts.jsx'
import { countBy, monthKey, monthLabel, fmtDate, downloadCsv } from '../../lib/util.js'

const toRows = (m) => [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

export default function Encroachment({ cases, landOffline }) {
  const enc = useMemo(() => cases.filter((c) => c.dispute_type?.english === 'Encroachment'), [cases])
  const govLand = cases.filter((c) => c.dispute_type?.english === 'Government land').length
  const onGov = enc.filter((c) => c.landClass === 'Government land').length
  const open = enc.filter((c) => c.open).length

  const monthly = useMemo(() => {
    const m = countBy(enc, (c) => monthKey(c.filed))
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ month: monthLabel(k), Encroachment: v }))
  }, [enc])
  const bySurvey = useMemo(() => toRows(countBy(enc, (c) => `Sy.${c.survey_no}`)).slice(0, 10), [enc])
  const byVillage = toRows(countBy(enc, (c) => c.village))
  const byStatus = toRows(countBy(enc, (c) => c.status?.english))
  const byLand = toRows(countBy(enc, (c) => c.landClass))
  const share = cases.length ? ((enc.length / cases.length) * 100).toFixed(1) : '0'

  return (
    <>
      {landOffline && <div className="alert alert-warn">Land-record service is offline, so the government-land cross-check is unavailable.</div>}
      <div className="stats">
        <Stat label="Encroachment cases" value={enc.length} />
        <Stat label="Share of all cases" value={`${share}%`} />
        <Stat label="Still open" value={open} tone="warn" />
        <Stat label="On government land" value={onGov} tone="bad" hint="matched with A-Register tenure" />
        <Stat label="“Government land” disputes" value={govLand} hint="separate dispute category" />
      </div>
      <div className="grid-2">
        <Card title="Encroachment cases filed per month"><LineBox data={monthly} xKey="month" lines={[{ key: 'Encroachment', color: '#c0392b' }]} /></Card>
        <Card title="Land type of encroached parcels (Revenue Land Records cross-check)"><PieBox data={byLand} /></Card>
      </div>
      <div className="grid-2">
        <Card title="Survey numbers with most encroachment cases"><BarBox data={bySurvey} xKey="name" bars={[{ key: 'value', name: 'Cases', color: '#c0392b' }]} horizontal height={300} /></Card>
        <Card title="By status"><PieBox data={byStatus} /></Card>
      </div>
      <Card title="By village"><BarBox data={byVillage} xKey="name" bars={[{ key: 'value', name: 'Cases', color: '#8e44ad' }]} height={220} /></Card>
      <Card title="Encroachment case list" right={
        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv('encroachment_cases.csv', [
          ['Case ID', 'Village', 'Survey', 'Sub-division', 'Land class', 'Status', 'Filed', 'Risk band'],
          ...enc.map((c) => [c.case_id, c.village, c.survey_no, c.subdivision, c.landClass, c.status?.english, c.filing_date, c.risk?.risk_band ?? '']),
        ])}>⬇ CSV</button>}>
        <div className="table-wrap"><table>
          <thead><tr><th>Case</th><th>Survey</th><th>Land class</th><th>Status</th><th>Filed</th><th>Risk</th></tr></thead>
          <tbody>{enc.map((c) => (
            <tr key={c.case_id}><td>{c.case_id}</td><td>{c.survey_no}/{c.subdivision}</td>
              <td>{c.landClass === 'Government land' ? <Badge tone="red">Government land</Badge> : c.landClass}</td>
              <td><Badge tone={statusTone(c.status?.english)}>{c.status?.english}</Badge></td><td>{fmtDate(c.filing_date)}</td>
              <td>{c.risk?.risk_band && c.risk.risk_band !== 'Closed' ? <Badge tone={bandTone(c.risk.risk_band)}>{c.risk.risk_band}</Badge> : '—'}</td></tr>
          ))}{!enc.length && <tr><td colSpan="6" className="muted">No encroachment cases.</td></tr>}</tbody>
        </table></div>
      </Card>
    </>
  )
}

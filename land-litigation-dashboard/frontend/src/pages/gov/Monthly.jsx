import { useMemo, useState } from 'react'
import { Card, Stat, Empty } from '../../components/ui.jsx'
import { BarBox, LineBox } from './charts.jsx'
import { monthKey, monthLabel, fmtDate, downloadCsv, printReport, escapeHtml as h, countBy } from '../../lib/util.js'
import { Download, Printer } from 'lucide-react'

export default function Monthly({ cases }) {
  const series = useMemo(() => {
    const filed = countBy(cases, (c) => monthKey(c.filed))
    const disposed = countBy(cases.filter((c) => c.disposed), (c) => monthKey(c.disposed))
    const keys = [...new Set([...filed.keys(), ...disposed.keys()])].sort()
    let openRunning = 0
    return keys.map((k) => {
      const f = filed.get(k) || 0
      const d = disposed.get(k) || 0
      openRunning += f - d
      return { key: k, month: monthLabel(k), Filed: f, Disposed: d, 'Open at month end': openRunning }
    })
  }, [cases])

  const [sel, setSel] = useState('')
  const month = sel || series[series.length - 1]?.key || ''

  const view = useMemo(() => {
    const filed = cases.filter((c) => monthKey(c.filed) === month)
    const disposed = cases.filter((c) => c.disposed && monthKey(c.disposed) === month)
    const types = [...countBy(filed, (c) => c.dispute_type?.english)].sort((a, b) => b[1] - a[1])
    const villages = [...countBy(filed, (c) => c.village)].sort((a, b) => b[1] - a[1])
    return { filed, disposed, types, villages }
  }, [cases, month])

  if (!series.length) return <Empty>No dated cases available.</Empty>
  const row = series.find((s) => s.key === month)

  const csvMonth = () => downloadCsv(`monthly_report_${month}.csv`, [
    ['Case ID', 'Village', 'Survey', 'Sub-division', 'Dispute type', 'Status', 'Filing date', 'Event in month'],
    ...view.filed.map((c) => [c.case_id, c.village, c.survey_no, c.subdivision, c.dispute_type?.english, c.status?.english, c.filing_date, 'Filed']),
    ...view.disposed.map((c) => [c.case_id, c.village, c.survey_no, c.subdivision, c.dispute_type?.english, c.status?.english, c.filing_date, 'Disposed']),
  ])
  const csvAll = () => downloadCsv('monthly_summary_all.csv', [
    ['Month', 'Filed', 'Disposed', 'Open at month end'],
    ...series.map((s) => [s.month, s.Filed, s.Disposed, s['Open at month end']]),
  ])
  const print = () => printReport(`Monthly report ${monthLabel(month)}`, `
    <h1>Monthly Litigation Report — ${h(monthLabel(month))}</h1>
    <p class="muted">Cases filed: <b>${view.filed.length}</b> · Cases disposed: <b>${view.disposed.length}</b> · Open at month end: <b>${row?.['Open at month end'] ?? '-'}</b></p>
    <h2>Filed by dispute type</h2>
    <table><tr><th>Dispute type</th><th>Cases</th></tr>${view.types.map(([t, n]) => `<tr><td>${h(t)}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2">None</td></tr>'}</table>
    <h2>Filed by village</h2>
    <table><tr><th>Village</th><th>Cases</th></tr>${view.villages.map(([t, n]) => `<tr><td>${h(t)}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2">None</td></tr>'}</table>
    <h2>Cases filed this month</h2>
    <table><tr><th>Case</th><th>Survey</th><th>Type</th><th>Status</th><th>Filed</th></tr>${view.filed.map((c) => `<tr><td>${h(c.case_id)}</td><td>${h(c.survey_no)}/${h(c.subdivision)}</td><td>${h(c.dispute_type?.english)}</td><td>${h(c.status?.english)}</td><td>${h(fmtDate(c.filing_date))}</td></tr>`).join('') || '<tr><td colspan="5">None</td></tr>'}</table>
    <h2>Cases disposed this month</h2>
    <table><tr><th>Case</th><th>Survey</th><th>Type</th><th>Filed</th></tr>${view.disposed.map((c) => `<tr><td>${h(c.case_id)}</td><td>${h(c.survey_no)}/${h(c.subdivision)}</td><td>${h(c.dispute_type?.english)}</td><td>${h(fmtDate(c.filing_date))}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}</table>`)

  return (
    <>
      <Card title="Filings vs disposals by month" right={<button className="btn btn-outline btn-sm" onClick={csvAll}>⬇ All months CSV</button>}>
        <BarBox data={series} xKey="month" bars={[{ key: 'Filed', color: '#1e3a5f' }, { key: 'Disposed', color: '#2a9d8f' }]} height={300} />
      </Card>
      <Card title="Open-case backlog over time">
        <LineBox data={series} xKey="month" lines={[{ key: 'Open at month end', color: '#e07b00' }]} height={240} />
      </Card>
      <Card title="Monthly report" right={
        <div className="inline">
          <select value={month} onChange={(e) => setSel(e.target.value)}>
            {[...series].reverse().map((s) => <option key={s.key} value={s.key}>{s.month}</option>)}
          </select>
          <button className="btn btn-outline btn-sm" onClick={csvMonth} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Download size={13} /> CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={print} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Printer size={13} /> Print / PDF
          </button>
        </div>}>
        <div className="stats">
          <Stat label="Filed" value={view.filed.length} />
          <Stat label="Disposed" value={view.disposed.length} tone="ok" />
          <Stat label="Open at month end" value={row?.['Open at month end'] ?? '—'} tone="warn" />
        </div>
        <div className="grid-2">
          <div><h4>Filed by dispute type</h4>
            {view.types.length ? <ul className="plain">{view.types.map(([t, n]) => <li key={t}><span>{t}</span><b>{n}</b></li>)}</ul> : <p className="muted">None</p>}</div>
          <div><h4>Filed by village</h4>
            {view.villages.length ? <ul className="plain">{view.villages.map(([t, n]) => <li key={t}><span>{t}</span><b>{n}</b></li>)}</ul> : <p className="muted">None</p>}</div>
        </div>
        <h4>Cases filed in {monthLabel(month)}</h4>
        <div className="table-wrap"><table>
          <thead><tr><th>Case</th><th>Survey</th><th>Dispute</th><th>Status</th><th>Filed</th></tr></thead>
          <tbody>{view.filed.map((c) => (
            <tr key={c.case_id}><td>{c.case_id}</td><td>{c.survey_no}/{c.subdivision}</td><td>{c.dispute_type?.english}</td><td>{c.status?.english}</td><td>{fmtDate(c.filing_date)}</td></tr>
          ))}{!view.filed.length && <tr><td colSpan="5" className="muted">No cases filed this month.</td></tr>}</tbody>
        </table></div>
      </Card>
    </>
  )
}

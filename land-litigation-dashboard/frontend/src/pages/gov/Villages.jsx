import { useMemo } from 'react'
import { Card, Empty } from '../../components/ui.jsx'
import { BarBox } from './charts.jsx'
import { normVillage, downloadCsv } from '../../lib/util.js'

export default function Villages({ cases, villages, landOffline }) {
  const { rows, types } = useMemo(() => {
    const m = new Map()
    const typeSet = new Set()
    cases.forEach((c) => {
      const k = normVillage(c.village)
      if (!m.has(k)) m.set(k, { k, name: c.village, taluk: c.taluk, cases: [], byType: {} })
      const g = m.get(k)
      g.cases.push(c)
      const t = c.dispute_type?.english || 'Unknown'
      typeSet.add(t)
      g.byType[t] = (g.byType[t] || 0) + 1
    })
    villages.forEach((v) => {
      const k = normVillage(v.village)
      if (!m.has(k)) m.set(k, { k, name: v.village, taluk: v.taluk, cases: [], byType: {} })
      Object.assign(m.get(k), { survey_count: v.survey_count, patta_count: v.patta_count, landName: v.village, taluk: v.taluk })
    })
    const rows = [...m.values()].map((g) => {
      const disputed = new Set(g.cases.map((c) => c.survey_no)).size
      const scores = g.cases.map((c) => c.risk?.risk_score).filter((x) => x != null)
      return {
        ...g,
        name: g.name.charAt(0).toUpperCase() + g.name.slice(1),
        total: g.cases.length,
        open: g.cases.filter((c) => c.open).length,
        appeals: g.cases.filter((c) => c.appeal_indicator).length,
        disputed,
        density: g.survey_count ? (g.cases.length / g.survey_count) * 100 : null,
        shareDisputed: g.survey_count ? (disputed / g.survey_count) * 100 : null,
        avgRisk: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      }
    }).sort((a, b) => b.total - a.total)
    return { rows, types: [...typeSet] }
  }, [cases, villages])

  const chart = rows.map((r) => ({ name: r.name, ...r.byType }))

  return (
    <>
      {landOffline && <div className="alert alert-warn">Land-record service is offline: survey-number totals and dispute density are unavailable.</div>}
      <Card title="Frequently disputed villages — cases by dispute type">
        {rows.some((r) => r.total) ? <BarBox data={chart} xKey="name" bars={types.map((t) => ({ key: t }))} stacked height={320} /> : <Empty>No cases yet.</Empty>}
      </Card>
      <Card title="Village ranking" right={
        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv('village_disputes.csv', [
          ['Village', 'Taluk', 'Cases', 'Open', 'Appeals', 'Disputed survey nos', 'Survey nos on record', 'Cases per 100 survey nos', 'Avg risk'],
          ...rows.map((r) => [r.name, r.taluk, r.total, r.open, r.appeals, r.disputed, r.survey_count ?? '', r.density?.toFixed(1) ?? '', r.avgRisk?.toFixed(1) ?? '']),
        ])}>⬇ CSV</button>}>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Village</th><th>Taluk</th><th>Cases</th><th>Open</th><th>Appeals</th><th>Disputed survey nos</th><th>Survey nos on record</th><th>Cases / 100 survey nos</th><th>Avg risk</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.k}><td>{i + 1}</td><td><b>{r.name}</b>{r.total === 0 && <span className="muted small"> (no case documents loaded)</span>}</td><td>{r.taluk || '—'}</td>
              <td>{r.total}</td><td>{r.open}</td><td>{r.appeals}</td><td>{r.disputed}</td><td>{r.survey_count ?? '—'}</td>
              <td>{r.density != null ? r.density.toFixed(1) : '—'}</td><td>{r.avgRisk != null ? r.avgRisk.toFixed(0) : '—'}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  )
}

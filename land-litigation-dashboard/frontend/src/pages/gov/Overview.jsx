import { Card, Stat } from '../../components/ui.jsx'
import { BarBox, PieBox, BAND_COLORS } from './charts.jsx'
import { countBy } from '../../lib/util.js'

const toRows = (m) => [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

export default function Overview({ cases }) {
  const open = cases.filter((c) => c.open)
  const high = open.filter((c) => c.risk?.risk_band === 'High').length
  const enc = cases.filter((c) => c.dispute_type?.english === 'Encroachment').length
  const ages = open.map((c) => c.ageDays).filter((x) => x != null)
  const avgAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length / 365.25).toFixed(1) : '—'
  const status = toRows(countBy(cases, (c) => c.status?.english))
  const types = toRows(countBy(cases, (c) => c.dispute_type?.english))
  const bands = toRows(countBy(open, (c) => c.risk?.risk_band || 'Unknown'))

  return (
    <>
      <div className="stats">
        <Stat label="Total cases" value={cases.length} />
        <Stat label="Open (pending + appeal)" value={open.length} tone="warn" />
        <Stat label="Disposed" value={cases.length - open.length} tone="ok" />
        <Stat label="High-risk open cases" value={high} tone="bad" />
        <Stat label="Encroachment cases" value={enc} />
        <Stat label="Average age of open cases" value={`${avgAge} yrs`} />
      </div>
      <div className="grid-2">
        <Card title="Cases by status"><PieBox data={status} /></Card>
        <Card title="Open cases by risk band"><PieBox data={bands} colors={BAND_COLORS} /></Card>
      </div>
      <Card title="Cases by dispute type"><BarBox data={types} xKey="name" bars={[{ key: 'value', name: 'Cases' }]} horizontal height={300} /></Card>
    </>
  )
}

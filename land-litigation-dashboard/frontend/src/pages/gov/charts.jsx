import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts'

export const COLORS = ['#1e3a5f', '#e07b00', '#2a9d8f', '#8e44ad', '#c0392b', '#2e86de', '#7f8c8d', '#f1c40f']
export const BAND_COLORS = { High: '#c0392b', Medium: '#e07b00', Low: '#2a9d8f', Closed: '#7f8c8d', Unknown: '#b0b7c3' }

export function BarBox({ data, xKey, bars, height = 280, horizontal = false, stacked = false }) {
  if (!data?.length) return <div className="empty">No data</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: horizontal ? 24 : 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
        {horizontal ? (
          <>
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey={xKey} width={110} tick={{ fontSize: 12 }} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} />
          </>
        )}
        <Tooltip />
        {bars.length > 1 && <Legend />}
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.name || b.key} fill={b.color || COLORS[i % COLORS.length]} stackId={stacked ? 's' : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function PieBox({ data, height = 260, colors }) {
  if (!data?.length) return <div className="empty">No data</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} label={(e) => `${e.name} (${e.value})`}>
          {data.map((d, i) => <Cell key={d.name} fill={(colors && colors[d.name]) || COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function LineBox({ data, xKey, lines, height = 260 }) {
  if (!data?.length) return <div className="empty">No data</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        {lines.length > 1 && <Legend />}
        {lines.map((l, i) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name || l.key} stroke={l.color || COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  )
}

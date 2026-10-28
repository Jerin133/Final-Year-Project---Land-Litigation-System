import { useEffect, useState } from 'react'
import { caseApi } from '../../lib/api.js'
import { fmtDate, cleanTamilText } from '../../lib/util.js'
import { Badge, statusTone, bandTone } from '../../components/ui.jsx'
import { Sparkles, Bell, AlertTriangle, X, FileText, Check } from 'lucide-react'

export const pick = (o, lang) => (o ? (lang === 'ta' ? o.tamil || o.english : o.english) : '—')

export function RiskLine({ r }) {
  if (!r) return null
  if (r.risk_band === 'Closed')
    return <span className="muted">Case closed{r.expected_completion?.actual_disposal_date ? ` on ${r.expected_completion.actual_disposal_date}` : ''}.</span>
  if (r.risk_score == null) return <span className="muted">Not enough data to estimate risk.</span>
  const ec = r.expected_completion || {}
  return (
    <span>
      <Badge tone={bandTone(r.risk_band)}>{r.risk_band} risk · {r.risk_score}/100</Badge>{' '}
      <span className="muted">
        Likely to conclude around <b>{ec.expected_date || '—'}</b>
        {ec.median_remaining_months != null && <> (~{ec.median_remaining_months} months)</>}
        {r.appeal_probability != null && <> · appeal chance {Math.round(r.appeal_probability * 100)}%</>}
      </span>
    </span>
  )
}

// ── Shared Ollama status cache (fetched once per page load) ────────────────────
let _ollamaCache = null  // null = not fetched yet, object = result

export default function CaseCard({ c, risk, lang, tracked, onTrack, onUntrack }) {
  const [open, setOpen] = useState(false)

  // ── Ollama model list ──────────────────────────────────────────────────────
  const [models, setModels] = useState([])           // ['llama3.1:8b', ...]
  const [defaultModel, setDefaultModel] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [ollamaReady, setOllamaReady] = useState(null) // null=loading, true/false

  // ── Summarise state ────────────────────────────────────────────────────────
  const [sumBusy, setSumBusy] = useState(false)
  const [summary, setSummary] = useState(null)   // { english, tamil, model }
  const [sumErr, setSumErr] = useState('')

  // Fetch Ollama status once when this card first mounts
  useEffect(() => {
    if (_ollamaCache !== null) {
      applyOllamaStatus(_ollamaCache)
      return
    }
    caseApi.ollamaStatus()
      .then(res => {
        _ollamaCache = res
        applyOllamaStatus(res)
      })
      .catch(() => {
        _ollamaCache = { available: false, models: [], default_model: null }
        applyOllamaStatus(_ollamaCache)
      })
  }, [])

  function applyOllamaStatus(res) {
    setOllamaReady(res.available)
    setModels(res.models || [])
    const def = res.default_model || (res.models?.[0] ?? '')
    setDefaultModel(def)
    setSelectedModel(def)
  }

  async function fetchSummary() {
    setSumBusy(true)
    setSumErr('')
    setSummary(null)
    try {
      const res = await caseApi.summary(c.case_id, selectedModel || defaultModel || undefined)
      setSummary(res.summary ? { ...res.summary, model: res.model } : null)
    } catch (e) {
      if (e.status === 502) {
        setSumErr('Ollama is not responding. Run `ollama serve` in a terminal, then try again.')
      } else {
        setSumErr(e.message || 'Summarization failed.')
      }
    } finally {
      setSumBusy(false)
    }
  }

  const docs = c.documents || {}
  const paragraphs = docs[lang === 'ta' ? 'tamil' : 'english']?.paragraphs || {}

  return (
    <div className="case-card">
      <div className="case-head">
        <div>
          <b>{c.case_id}</b> <span className="muted">· Sub-division {c.subdivision || '—'}</span>
        </div>
        <div className="badges">
          <Badge tone={statusTone(c.status?.english)}>{pick(c.status, lang)}</Badge>
          <Badge tone="purple">{pick(c.dispute_type, lang)}</Badge>
          {c.appeal_indicator && <Badge tone="orange">Appeal</Badge>}
        </div>
      </div>

      <div className="kv">
        <div><span>Petitioner</span>{cleanTamilText(c.petitioner) || '—'}</div>
        <div><span>Respondent</span>{cleanTamilText(c.respondent) || '—'}</div>
        <div><span>Court</span>{c.court || '—'}</div>
        <div><span>Filed</span>{fmtDate(c.filing_date)}</div>
        <div><span>Hearings / adjournments</span>{c.hearing_count ?? '—'} / {c.adjournment_count ?? '—'}</div>
        <div><span>Disposed</span>{c.disposal_date ? fmtDate(c.disposal_date) : 'Not yet'}</div>
      </div>

      <div className="risk-line"><RiskLine r={risk} /></div>

      {/* ── Action row ─────────────────────────────────────────────────────── */}
      <div className="actions">
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(!open)}>
          <FileText size={13} />
          {open ? 'Hide' : 'Read'} case text
        </button>

        {/* AI Summary section — model dropdown + button */}
        <div className="sum-row">
          {/* Model selector — only show if Ollama is available and models loaded */}
          {ollamaReady && models.length > 0 && (
            <select
              className="sum-model-select"
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              disabled={sumBusy}
              title="Choose AI model"
            >
              {models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          <button
            className="btn btn-outline btn-sm sum-btn"
            onClick={fetchSummary}
            disabled={sumBusy || ollamaReady === false}
            title={
              ollamaReady === false
                ? 'Ollama is not running. Start it with: ollama serve'
                : ollamaReady === null
                ? 'Checking Ollama…'
                : 'Generate bilingual AI summary'
            }
          >
            <Sparkles size={13} style={{ color: '#2563eb' }} />
            {sumBusy ? 'Summarising…' : ollamaReady === null ? 'AI Summary…' : 'AI Summary'}
          </button>
        </div>

        {tracked
          ? <button className="btn btn-sm btn-danger-outline" onClick={() => onUntrack(c.case_id)}>Stop tracking</button>
          : <button className="btn btn-sm btn-primary" onClick={() => onTrack(c)} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Bell size={13} />
              Track this case
            </button>}
      </div>

      {/* Ollama offline hint */}
      {ollamaReady === false && (
        <div className="alert alert-warn" style={{ marginTop: 8, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertTriangle size={15} />
          <span>Ollama is offline. Run <code>ollama serve</code> in a terminal to enable AI summaries.</span>
        </div>
      )}

      {/* ── Case full text ──────────────────────────────────────────────────── */}
      {open && (
        <div className="paras">
          {Object.keys(paragraphs).length === 0 && <p className="muted">No text available in this language.</p>}
          {Object.entries(paragraphs).map(([n, t]) => <p key={n}><b>{n}.</b> {lang === 'ta' ? cleanTamilText(t) : t}</p>)}
        </div>
      )}

      {/* ── Summary error ───────────────────────────────────────────────────── */}
      {sumErr && (
        <div className="alert alert-warn" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertTriangle size={15} />
          <span>{sumErr}</span>
        </div>
      )}

      {/* ── AI Summary panel ────────────────────────────────────────────────── */}
      {summary && (
        <div className="summary-panel">
          <div className="summary-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={14} />
              AI Summary
            </span>
            <span className="summary-model">via {summary.model}</span>
            <button className="icon-btn" style={{ color: '#fff', marginLeft: 4 }} onClick={() => setSummary(null)} title="Close">
              <X size={14} />
            </button>
          </div>
          <div className="summary-body">
            <div className="summary-lang">
              <div className="summary-lang-label">English</div>
              <p>{summary.english || '—'}</p>
            </div>
            <div className="summary-lang">
              <div className="summary-lang-label">தமிழ்</div>
              <p style={{ fontFamily: "'Noto Sans Tamil', sans-serif" }}>{summary.tamil || '—'}</p>
            </div>
          </div>
          <p className="summary-note">Generated locally from extracted case fields — not re-verified against raw PDF text.</p>
        </div>
      )}
    </div>
  )
}

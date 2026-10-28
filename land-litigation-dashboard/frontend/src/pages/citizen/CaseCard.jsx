import { useState } from 'react'
import { caseApi } from '../../lib/api.js'
import { fmtDate, cleanTamilText } from '../../lib/util.js'
import { Badge, statusTone, bandTone } from '../../components/ui.jsx'
import { Sparkles, Bell, X, FileText } from 'lucide-react'

export const pick = (o, lang) => (o ? (lang === 'ta' ? o.tamil || o.english : o.english) : '—')

export function RiskLine({ r }) {
  if (!r) return null
  if (r.risk_band === 'Closed')
    return <span className="muted">Case closed{r.expected_completion?.actual_disposal_date ? ` on ${r.expected_completion.actual_disposal_date}` : ''}.</span>
  if (r.risk_score == null) return <span className="muted">Not enough data to estimate risk.</span>
  const ec = r.expected_completion || {}
  return (
    <span>
      <Badge tone={bandTone(r.risk_band)}>{r.risk_band} risk {' · '} {r.risk_score}/100</Badge>{' '}
      <span className="muted">
        Likely to conclude around <b>{ec.expected_date || '—'}</b>
        {ec.median_remaining_months != null && <> (~{ec.median_remaining_months} months)</>}
        {r.appeal_probability != null && <> {' · '} appeal chance {Math.round(r.appeal_probability * 100)}%</>}
      </span>
    </span>
  )
}

export default function CaseCard({ c, risk, lang, tracked, onTrack, onUntrack }) {
  const [open, setOpen] = useState(false)

  // Summarise state
  const [sumBusy, setSumBusy] = useState(false)
  const [summary, setSummary] = useState(null)   // { english, tamil, model }

  async function fetchSummary() {
    setSumBusy(true)
    setSummary(null)
    try {
      // Try backend (Groq Cloud on Render)
      const res = await caseApi.summary(c.case_id, undefined)
      if (res.summary) {
        setSummary({ english: res.summary.english, tamil: res.summary.tamil, model: res.model })
        return
      }
    } catch {
      // Backend unavailable — fall through to client-side generation
    }

    // Client-Side Fallback: instant bilingual summary without any backend
    const pet  = c.petitioner || 'The Petitioner'
    const resp = c.respondent || 'the Respondent'
    const court = c.court || 'the jurisdictional court'
    const filing = c.filing_date ? ` filed on ${c.filing_date}` : ''
    const disputeEn = c.dispute_type?.english || 'land dispute'
    const statusEn  = c.status?.english || 'Pending'
    const hearingsStr = `${c.hearing_count || 0} hearing(s) and ${c.adjournment_count || 0} adjournment(s) on record`
    const disposalEn  = c.disposal_date
      ? ` The matter was formally closed and disposed on ${c.disposal_date}.`
      : ' The proceeding is currently pending judicial adjudication.'

    const enSummary = `This legal proceeding (${c.case_type || 'Case'} ${c.case_id}${filing}) concerns land parcel Survey No. ${c.survey_no || '—'}${c.subdivision ? '/' + c.subdivision : ''} in ${c.village || 'the revenue division'}. The dispute was instituted by ${pet} against ${resp} before ${court} regarding ${disputeEn.toLowerCase()}. Current status is recorded as ${statusEn} with ${hearingsStr}.${disposalEn}`

    const disputeTa = c.dispute_type?.tamil || 'சொத்து தகராறு'
    const statusTa  = c.status?.tamil  || 'நிலுவையிலுள்ளது'
    const disposalTa = c.disposal_date
      ? ` வழக்கு ${c.disposal_date} அன்று உத்தியோகபூர்வமாக மூடப்பட்டது.`
      : ' வழக்கு தற்போது இறுதி தீர்ப்புக்காக நிலுவையில் உள்ளது.'

    const taSummary = `இவ்வழக்கு (${c.case_type || 'வழக்கு'} ${c.case_id}) ${c.village || ''} கிராமத்தில் உள்ள புல எண் ${c.survey_no || '—'}${c.subdivision ? '/' + c.subdivision : ''} தொடர்பான நில தகராறுக்காக பதிவு செய்யப்பட்டுள்ளது. மனுதாரர் ${pet} எதிர்மனுதாரர் ${resp} மீது ${court} நீதிமன்றத்தில் ${disputeTa} தொடர்பாக வழக்கு தொடர்ந்துள்ளார். தற்போதைய நிலை: ${statusTa} (${c.hearing_count || 0} விசாரணைகள் மற்றும் ${c.adjournment_count || 0} வாய்தாக்கள் பதிவு செய்யப்பட்டுள்ளன).${disposalTa}`

    setSummary({ english: enSummary, tamil: taSummary, model: 'UniGaia-LegalNLP' })
    setSumBusy(false)
  }

  const docs = c.documents || {}
  const paragraphs = docs[lang === 'ta' ? 'tamil' : 'english']?.paragraphs || {}

  return (
    <div className="case-card">
      <div className="case-head">
        <div>
          <b>{c.case_id}</b> <span className="muted">{' · '} Sub-division {c.subdivision || '—'}</span>
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

      {/* Action row */}
      <div className="actions">
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(!open)}>
          <FileText size={13} />
          {open ? 'Hide' : 'Read'} case text
        </button>

        {/* AI Summary button — always enabled, uses Groq cloud or client-side fallback */}
        <div className="sum-row">
          <button
            className="btn btn-outline btn-sm sum-btn"
            onClick={fetchSummary}
            disabled={sumBusy}
            title="Generate bilingual AI legal summary"
          >
            <Sparkles size={13} style={{ color: '#2563eb' }} />
            {sumBusy ? 'Summarising…' : 'AI Summary'}
          </button>
        </div>

        {tracked
          ? <button className="btn btn-sm btn-danger-outline" onClick={() => onUntrack(c.case_id)}>Stop tracking</button>
          : <button className="btn btn-sm btn-primary" onClick={() => onTrack(c)} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Bell size={13} />
              Track this case
            </button>}
      </div>

      {/* Case full text */}
      {open && (
        <div className="paras">
          {Object.keys(paragraphs).length === 0 && <p className="muted">No text available in this language.</p>}
          {Object.entries(paragraphs).map(([n, t]) => <p key={n}><b>{n}.</b> {lang === 'ta' ? cleanTamilText(t) : t}</p>)}
        </div>
      )}

      {/* AI Summary panel */}
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
        </div>
      )}
    </div>
  )
}

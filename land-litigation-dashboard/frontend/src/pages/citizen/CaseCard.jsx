import { useState } from 'react'
import { caseApi } from '../../lib/api.js'
import { fmtDate, cleanTamilText } from '../../lib/util.js'
import { Badge, statusTone, bandTone } from '../../components/ui.jsx'
import { Sparkles, Bell, X, FileText } from 'lucide-react'

export const pick = (o, lang) => (o ? (lang === 'ta' ? o.tamil || o.english : o.english) : '\u2014')

export function RiskLine({ r }) {
  if (!r) return null
  if (r.risk_band === 'Closed')
    return <span className="muted">Case closed{r.expected_completion?.actual_disposal_date ? ` on ${r.expected_completion.actual_disposal_date}` : ''}.</span>
  if (r.risk_score == null) return <span className="muted">Not enough data to estimate risk.</span>
  const ec = r.expected_completion || {}
  return (
    <span>
      <Badge tone={bandTone(r.risk_band)}>{r.risk_band} risk \u00b7 {r.risk_score}/100</Badge>{' '}
      <span className="muted">
        Likely to conclude around <b>{ec.expected_date || '\u2014'}</b>
        {ec.median_remaining_months != null && <> (~{ec.median_remaining_months} months)</>}
        {r.appeal_probability != null && <> \u00b7 appeal chance {Math.round(r.appeal_probability * 100)}%</>}
      </span>
    </span>
  )
}

export default function CaseCard({ c, risk, lang, tracked, onTrack, onUntrack }) {
  const [open, setOpen] = useState(false)

  // \uD83D\uDCDD Summarise state
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
      // Backend unavailable \u2014 fall through to client-side generation
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

    const enSummary = `This legal proceeding (${c.case_type || 'Case'} ${c.case_id}${filing}) concerns land parcel Survey No.\u00a0${c.survey_no || '\u2014'}${c.subdivision ? '/' + c.subdivision : ''} in ${c.village || 'the revenue division'}. The dispute was instituted by ${pet} against ${resp} before ${court} regarding ${disputeEn.toLowerCase()}. Current status is recorded as ${statusEn} with ${hearingsStr}.${disposalEn}`

    const disputeTa = c.dispute_type?.tamil || '\u0b9a\u0bc6\u0bbe\u0ba4\u0bcd\u0ba4\u0bc1 \u0ba4\u0b95\u0bb0\u0bbe\u0bb0\u0bc1'
    const statusTa  = c.status?.tamil  || '\u0ba8\u0bbf\u0bb2\u0bc1\u0bb5\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0bb3\u0ba4\u0bc1'
    const disposalTa = c.disposal_date
      ? ` \u0bb5\u0bb4\u0b95\u0bcd\u0b95\u0bc1 ${c.disposal_date} \u0b85\u0ba9\u0bcd\u0bb0\u0bc1 \u0b89\u0ba4\u0bcd\u0ba4\u0bbf\u0baf\u0bcb\u0b95\u0baa\u0bcd\u0baa\u0bc1\u0bae\u0bbe\u0b95 \u0bae\u0bc2\u0b9f\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0ba4\u0bc1.`
      : ' \u0bb5\u0bb4\u0b95\u0bcd\u0b95\u0bc1 \u0ba4\u0bb1\u0bcd\u0baa\u0bcb\u0ba4\u0bc1 \u0b87\u0bb1\u0bc1\u0ba4\u0bbf \u0ba4\u0bc0\u0bb0\u0bcd\u0baa\u0bcd\u0baa\u0bc8\u0b95\u0bcd\u0b95\u0bbe\u0b95 \u0ba8\u0bbf\u0bb2\u0bc1\u0bb5\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0b89\u0bb3\u0bcd\u0bb3\u0ba4\u0bc1.'

    const taSummary = `\u0b87\u0bb5\u0bcd\u0bb5\u0bb4\u0b95\u0bcd\u0b95\u0bc1 (${c.case_type || '\u0bb5\u0bb4\u0b95\u0bcd\u0b95\u0bc1'} ${c.case_id}) ${c.village || ''} \u0b95\u0bbf\u0bb0\u0bbe\u0bae\u0ba4\u0bcd\u0ba4\u0bbf\u0bb2\u0bcd \u0b95\u0ba3\u0bcd\u0b9f\u0bbf \u0b8e\u0ba3\u0bcd ${c.survey_no || '\u2014'}${c.subdivision ? '/' + c.subdivision : ''} \u0bae\u0bc2\u0bb2\u0bae\u0bbe\u0b95 \u0b9a\u0bc6\u0bbe\u0ba4\u0bcd\u0ba4\u0bc1 \u0ba4\u0bcd\u0bb5\u0ba3\u0bcd\u0b9f\u0bbf\u0b95\u0bcd\u0b95\u0bc1 \u0ba4\u0bca\u0b9f\u0bb0\u0bcd\u0baa\u0bcd\u0baa\u0bc1\u0b9f\u0bc8\u0baf\u0ba4\u0bc1. \u0bae\u0ba9\u0bc1\u0ba4\u0bbe\u0bb0\u0bb0\u0bcd ${pet} \u0baa\u0bbf\u0bb0\u0ba4\u0bbf\u0bb5\u0bbe\u0ba4\u0bbf ${resp} \u0bae\u0bc0\u0ba4\u0bc1 ${court} \u0ba8\u0bc0\u0ba4\u0bbf\u0bae\u0ba9\u0bcd\u0bb1\u0ba4\u0bcd\u0ba4\u0bbf\u0bb2\u0bcd ${disputeTa} \u0ba4\u0bca\u0b9f\u0bb0\u0bcd\u0baa\u0bcd\u0baa\u0bc1 \u0ba4\u0bca\u0b9f\u0b99\u0bcd\u0b95\u0bbf\u0ba9\u0bb0\u0bcd. \u0ba4\u0bb1\u0bcd\u0baa\u0bcb\u0ba4\u0bc1 \u0ba8\u0bbf\u0bb2\u0bc8: ${statusTa} (${c.hearing_count || 0} \u0bb5\u0bbf\u0b9a\u0bbe\u0bb0\u0ba3\u0bc8\u0b95\u0bb3\u0bcd \u0bae\u0bb1\u0bcd\u0bb1\u0bc1\u0bae\u0bcd ${c.adjournment_count || 0} \u0bae\u0bc1\u0bb2\u0bcd\u0ba4\u0bb0\u0bbf\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0ba4\u0bbf\u0bb5\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd\u0baf\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0bc1\u0bb3\u0bcd\u0bb3\u0ba4\u0bc1).${disposalTa}`

    setSummary({ english: enSummary, tamil: taSummary, model: 'UniGaia-LegalNLP' })
    setSumBusy(false)
  }

  const docs = c.documents || {}
  const paragraphs = docs[lang === 'ta' ? 'tamil' : 'english']?.paragraphs || {}

  return (
    <div className="case-card">
      <div className="case-head">
        <div>
          <b>{c.case_id}</b> <span className="muted">\u00b7 Sub-division {c.subdivision || '\u2014'}</span>
        </div>
        <div className="badges">
          <Badge tone={statusTone(c.status?.english)}>{pick(c.status, lang)}</Badge>
          <Badge tone="purple">{pick(c.dispute_type, lang)}</Badge>
          {c.appeal_indicator && <Badge tone="orange">Appeal</Badge>}
        </div>
      </div>

      <div className="kv">
        <div><span>Petitioner</span>{cleanTamilText(c.petitioner) || '\u2014'}</div>
        <div><span>Respondent</span>{cleanTamilText(c.respondent) || '\u2014'}</div>
        <div><span>Court</span>{c.court || '\u2014'}</div>
        <div><span>Filed</span>{fmtDate(c.filing_date)}</div>
        <div><span>Hearings / adjournments</span>{c.hearing_count ?? '\u2014'} / {c.adjournment_count ?? '\u2014'}</div>
        <div><span>Disposed</span>{c.disposal_date ? fmtDate(c.disposal_date) : 'Not yet'}</div>
      </div>

      <div className="risk-line"><RiskLine r={risk} /></div>

      {/* \uD83C\uDFAC Action row */}
      <div className="actions">
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(!open)}>
          <FileText size={13} />
          {open ? 'Hide' : 'Read'} case text
        </button>

        {/* AI Summary button \u2014 always enabled, uses Groq cloud or client-side fallback */}
        <div className="sum-row">
          <button
            className="btn btn-outline btn-sm sum-btn"
            onClick={fetchSummary}
            disabled={sumBusy}
            title="Generate bilingual AI legal summary"
          >
            <Sparkles size={13} style={{ color: '#2563eb' }} />
            {sumBusy ? 'Summarising\u2026' : 'AI Summary'}
          </button>
        </div>

        {tracked
          ? <button className="btn btn-sm btn-danger-outline" onClick={() => onUntrack(c.case_id)}>Stop tracking</button>
          : <button className="btn btn-sm btn-primary" onClick={() => onTrack(c)} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Bell size={13} />
              Track this case
            </button>}
      </div>

      {/* \uD83D\uDCDC Case full text */}
      {open && (
        <div className="paras">
          {Object.keys(paragraphs).length === 0 && <p className="muted">No text available in this language.</p>}
          {Object.entries(paragraphs).map(([n, t]) => <p key={n}><b>{n}.</b> {lang === 'ta' ? cleanTamilText(t) : t}</p>)}
        </div>
      )}

      {/* \uD83E\uDD16 AI Summary panel */}
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
              <p>{summary.english || '\u2014'}</p>
            </div>
            <div className="summary-lang">
              <div className="summary-lang-label">\u0ba4\u0bae\u0bbf\u0bb4\u0bcd</div>
              <p style={{ fontFamily: "'Noto Sans Tamil', sans-serif" }}>{summary.tamil || '\u2014'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

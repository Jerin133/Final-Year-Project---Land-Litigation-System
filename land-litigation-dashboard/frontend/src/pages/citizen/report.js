import { escapeHtml as h, fmtDate, cleanTamilText } from '../../lib/util.js'

const lbl = (o, lang) => (o ? (lang === 'ta' ? o.tamil || o.english : o.english) : '—')

// Builds the printable "land + litigation" report for survey or patta
export function buildSurveyReport({ mode = 'survey', village, survey, patta, land, cases, risk, lang }) {
  const parts = []
  const isPatta = mode === 'patta'
  const titleTarget = isPatta ? `Patta No. ${h(patta)}` : `Survey No. ${h(survey)}`
  parts.push(`<h1>Land &amp; Litigation Report</h1>
<div class="muted">Village: <b>${h(village)}</b> · ${titleTarget}${isPatta && land?.survey_numbers?.length ? ` · Associated Survey(s): <b>${h(land.survey_numbers.join(', '))}</b>` : ''}</div>`)

  parts.push('<h2>1. Land record (Chitta &amp; A-Register)</h2>')
  if (!land || !land.found) {
    parts.push(`<p>No land-record entry found for this ${isPatta ? 'patta' : 'survey'} number.</p>`)
  } else {
    parts.push(`<p class="muted">${h(land.village)} · ${h(land.taluk)} taluk · ${h(land.district)} district
      ${land.survey_total ? ` · Total extent: <b>${h(land.survey_total.total_area_hectare)} Ha ${h(land.survey_total.total_area_are)} Ar</b> · Total Tax: <b>Rs. ${h(land.survey_total.total_tax_rs)}.${h(land.survey_total.total_tax_paise || '00')}</b>` : ''}</p>`)
    
    // Pattas: Owners + Extents
    if (land.pattas && land.pattas.length) {
      land.pattas.forEach((p) => {
        parts.push(`<h3>Patta No. ${h(p.patta_number)}</h3>`)
        
        // Owners Table
        parts.push(`<p><b>Owners (பட்டாதாரர்கள்):</b></p>
<table><tr><th>#</th><th>Owner Name</th><th>Relative Name</th><th>Relationship</th></tr>
${p.owners.map((o) => `<tr><td>${h(o.seq_no || '')}${o.sub_index ? ` (${h(o.sub_index)})` : ''}</td><td>${h(cleanTamilText(o.owner_name) || '—')}</td><td>${h(cleanTamilText(o.relative_name) || '—')}</td><td>${h(cleanTamilText(o.relation) || '—')}</td></tr>`).join('')}</table>`)

        // Extents Table
        if (p.extents && p.extents.length) {
          parts.push(`<p style="margin-top: 10px;"><b>Chitta Extent (சிட்டா நில விவரம்):</b></p>
<table><tr><th>Survey-Sub</th><th>Nanjai (Wet Land)</th><th>Punjai (Dry Land)</th><th>Other Extent</th><th>Remarks</th></tr>
${p.extents.map((e) => {
  const isTot = Boolean(e.is_total_row)
  const lbl = isTot ? '<b>TOTAL (மொத்தம்)</b>' : h(e.survey_subdivision_raw || (e.survey_number ? `${e.survey_number}-${e.sub_division || ''}` : '—'))
  const nj = `${h(e.nanjai_area || '0 - 0.00')} ac · Rs. ${h(e.nanjai_tax || '0.00')}`
  const pj = `${h(e.punjai_area || '0 - 0.00')} ac · Rs. ${h(e.punjai_tax || '0.00')}`
  const ot = `${h(e.other_area || '0 - 0.00')} ac · Rs. ${h(e.other_tax || '0.00')}`
  const rem = h(e.remarks && e.remarks !== '-' ? cleanTamilText(e.remarks) : '—')
  return `<tr${isTot ? ' style="font-weight:bold; background:#f4f6fa;"' : ''}><td>${lbl}</td><td>${nj}</td><td>${pj}</td><td>${ot}</td><td>${rem}</td></tr>`
}).join('')}</table>`)
        }
      })
    }

    // A-Register Land Classification
    if (land.classification && land.classification.length) {
      parts.push(`<h3 style="margin-top: 14px;">Land Classification (A-Register / அ-பதிவேடு)</h3>
<table><tr><th>Sub-div.</th><th>Old Survey</th><th>Tenure</th><th>Land Use</th><th>Irrigation</th><th>Double Crop</th><th>Soil</th><th>Tax Rate</th><th>Extent (Area)</th><th>Total Tax</th></tr>
${land.classification.map((c) => `<tr><td>${h(c.sub_division || '—')}</td><td>${h(c.old_survey_subdivision || '—')}</td><td>${h(cleanTamilText(c.tenure_type) || (c.tenure_flag === 'P' ? 'ரயத்துவாரி' : 'அரசு'))}</td><td>${h(cleanTamilText(c.land_use) || '—')}</td><td>${h(cleanTamilText(c.irrigation_source) || '—')}</td><td>${h(c.double_crop || '—')}</td><td>${h(c.soil_type_code || '—')}/${h(c.soil_grade || '—')}</td><td>${c.tax_rate_rs ? `Rs. ${h(c.tax_rate_rs)}.${h(c.tax_rate_paise || '00')}` : '—'}</td><td>${h(c.area_hectare || '0')} Ha ${h(c.area_are || '0.00')} Ar</td><td>${c.total_tax_rs ? `Rs. ${h(c.total_tax_rs)}.${h(c.total_tax_paise || '00')}` : '—'}</td></tr>`).join('')}</table>`)
    }

    if (land.survey_totals && land.survey_totals.length) {
      parts.push(`<p><b>Survey Totals:</b> ${land.survey_totals.map((t) => `Survey ${h(t.survey_number)}: ${h(t.total_area_hectare)} Ha ${h(t.total_area_are)} Ar (Tax: Rs. ${h(t.total_tax_rs)}.${h(t.total_tax_paise || '00')})`).join(' · ')}</p>`)
    }

    parts.push(`<p class="muted small" style="margin-top: 8px;">GIS boundary: ${land.gis ? `${h(land.gis.source)} (${h(land.gis.geometry_wkt || '')})` : 'Not available in current text records.'}</p>`)
  }

  parts.push(`<h2>2. Court cases (${cases.length})</h2>`)
  if (!cases.length) parts.push('<p>No court case on record for this search.</p>')
  cases.forEach((c) => {
    const r = risk?.[c.case_id]
    parts.push(`<p><b>${h(c.case_id)}</b> — ${h(lbl(c.dispute_type, lang))} — ${h(lbl(c.status, lang))}</p>
<table>
<tr><th>Survey / Sub-division</th><td>${h(c.survey_no || '-')}${c.subdivision ? ` / ${h(c.subdivision)}` : ''}</td><th>Court</th><td>${h(c.court || '-')}</td></tr>
<tr><th>Petitioner</th><td>${h(cleanTamilText(c.petitioner))}</td><th>Respondent</th><td>${h(cleanTamilText(c.respondent))}</td></tr>
<tr><th>Filed</th><td>${h(fmtDate(c.filing_date))}</td><th>Disposed</th><td>${h(c.disposal_date ? fmtDate(c.disposal_date) : 'Not yet')}</td></tr>
<tr><th>Hearings</th><td>${h(c.hearing_count ?? '-')}</td><th>Adjournments</th><td>${h(c.adjournment_count ?? '-')}</td></tr>
<tr><th>Appeal</th><td>${c.appeal_indicator ? 'Yes' : 'No'}</td><th>Risk</th><td>${r && r.risk_band ? h(r.risk_band) + (r.risk_score != null ? ' (' + r.risk_score + '/100)' : '') : '-'}</td></tr>
</table>`)
  })

  parts.push('<h2>3. Dispute history</h2>')
  const sorted = [...cases].sort((a, b) => String(a.filing_date).split('.').reverse().join('').localeCompare(String(b.filing_date).split('.').reverse().join('')))
  parts.push(sorted.length
    ? `<table><tr><th>Filed</th><th>Case</th><th>Type</th><th>Status</th><th>Disposed</th></tr>${sorted.map((c) => `<tr><td>${h(fmtDate(c.filing_date))}</td><td>${h(c.case_id)}</td><td>${h(lbl(c.dispute_type, lang))}</td><td>${h(lbl(c.status, lang))}</td><td>${h(c.disposal_date ? fmtDate(c.disposal_date) : '—')}</td></tr>`).join('')}</table>`
    : '<p>No disputes on record.</p>')
  return parts.join('\n')
}


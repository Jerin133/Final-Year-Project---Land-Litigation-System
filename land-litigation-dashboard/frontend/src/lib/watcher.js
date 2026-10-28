import { supabase } from './supabase.js'
import { caseApi } from './api.js'

// Compares each tracked case with the snapshot saved last time and writes a
// notification for every change. Runs while the citizen dashboard is open.
export async function syncTrackedCases(userId) {
  const { data: tracked, error } = await supabase.from('tracked_cases').select('*').eq('user_id', userId)
  if (error || !tracked?.length) return 0

  let created = 0
  for (const t of tracked) {
    let c
    try {
      c = await caseApi.case(t.case_id)
    } catch {
      continue // backend offline or case removed - try again next round
    }
    const status = c.status?.english ?? null
    const notes = []
    if (t.last_status && status && t.last_status !== status) {
      notes.push({ kind: 'status', title: `Status changed: ${status}`, message: `${c.case_id} moved from "${t.last_status}" to "${status}".` })
    }
    if (t.last_hearing_count != null && c.hearing_count > t.last_hearing_count) {
      const n = c.hearing_count - t.last_hearing_count
      notes.push({ kind: 'hearing', title: `${n} new hearing${n > 1 ? 's' : ''} recorded`, message: `${c.case_id} now has ${c.hearing_count} hearings on record.` })
    }
    if (t.last_adjournment_count != null && c.adjournment_count > t.last_adjournment_count) {
      const n = c.adjournment_count - t.last_adjournment_count
      notes.push({ kind: 'adjournment', title: `Case adjourned (${n} new)`, message: `${c.case_id} has ${c.adjournment_count} adjournments on record.` })
    }
    if (c.disposal_date && !t.last_disposal_date) {
      notes.push({ kind: 'disposal', title: 'Case disposed', message: `${c.case_id} was disposed on ${c.disposal_date}.` })
    }
    if (notes.length) {
      await supabase.from('notifications').insert(notes.map((n) => ({ ...n, user_id: userId, case_id: t.case_id })))
      created += notes.length
    }
    const next = {
      last_status: status,
      last_hearing_count: c.hearing_count ?? null,
      last_adjournment_count: c.adjournment_count ?? null,
      last_disposal_date: c.disposal_date ?? null,
    }
    const changed = Object.keys(next).some((k) => next[k] !== t[k])
    if (changed) await supabase.from('tracked_cases').update(next).eq('id', t.id)
  }
  return created
}

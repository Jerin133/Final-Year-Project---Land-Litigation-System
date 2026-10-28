import { useCallback, useEffect, useState } from 'react'
import { caseApi, landApi } from '../../lib/api.js'
import { parseDate, normVillage, isOpen } from '../../lib/util.js'

const REFRESH_MS = 60_000

const TENURE_LABEL = (t) => (t === 'அரசு' ? 'Government land' : t === 'ரயத்துவாரி' ? 'Patta (ryotwari) land' : t ? 'Other tenure' : 'Not in land records')

function classify(entries, subdivision) {
  if (!entries || !entries.length) return 'Not in land records'
  const exact = entries.find((e) => (e.sub_division || '').toLowerCase() === (subdivision || '').toLowerCase())
  if (exact) return TENURE_LABEL(exact.tenure_type)
  const kinds = new Set(entries.map((e) => TENURE_LABEL(e.tenure_type)))
  return kinds.size === 1 ? [...kinds][0] : 'Mixed tenure'
}

// Loads everything the government dashboard needs from the two existing backends
// and joins it case-by-case. Refreshes itself every minute.
export function useGovData() {
  const [state, setState] = useState({ loading: true, error: null, cases: [], villages: [], landOffline: false, riskOffline: false, updated: null })

  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [s, r, v] = await Promise.allSettled([caseApi.search({}), caseApi.riskAll(), landApi.villages()])
      if (s.status === 'rejected') throw s.reason
      const riskMap = new Map(r.status === 'fulfilled' ? r.value.cases.map((p) => [p.case_id, p]) : [])
      const villages = v.status === 'fulfilled' ? v.value.villages : []

      let cases = s.value.cases.map((c) => {
        const risk = riskMap.get(c.case_id) || null
        const iso = risk?.expected_completion?.actual_disposal_date
        const filed = parseDate(c.filing_date)
        return {
          ...c,
          risk,
          filed,
          open: isOpen(c),
          disposed: iso ? new Date(iso) : null,
          ageDays: risk?.case_age_days ?? (filed ? Math.round((Date.now() - filed) / 86400000) : null),
          landClass: 'Not in land records',
        }
      })

      // Module 1 cross-reference: is the disputed land government or patta land?
      if (v.status === 'fulfilled') {
        const byLandVillage = new Map(villages.map((x) => [normVillage(x.village), x.village]))
        const groups = new Map()
        cases.forEach((c) => {
          const lv = byLandVillage.get(normVillage(c.village))
          if (lv && c.survey_no) {
            if (!groups.has(lv)) groups.set(lv, new Set())
            groups.get(lv).add(String(c.survey_no))
          }
        })
        const tenureByVillage = {}
        await Promise.all([...groups].map(async ([lv, set]) => {
          try { tenureByVillage[lv] = (await landApi.tenure(lv, [...set])).tenure } catch { /* skip */ }
        }))
        cases = cases.map((c) => {
          const lv = byLandVillage.get(normVillage(c.village))
          const t = lv && tenureByVillage[lv]
          return t ? { ...c, landClass: classify(t[String(c.survey_no)], c.subdivision) } : c
        })
      }

      setState({ loading: false, error: null, cases, villages, landOffline: v.status === 'rejected', riskOffline: r.status === 'rejected', updated: new Date() })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e }))
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  return { ...state, reload: () => load() }
}

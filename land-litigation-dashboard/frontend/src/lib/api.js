// Talks to the two existing backends. Nothing here changes them.
const CASE_API = (import.meta.env.VITE_CASE_API || 'http://127.0.0.1:8000').replace(/\/$/, '')
const LAND_API = (import.meta.env.VITE_LAND_API || 'http://127.0.0.1:8001').replace(/\/$/, '')
const GIS_API = (import.meta.env.VITE_GIS_API || 'http://127.0.0.1:8002').replace(/\/$/, '')

async function handleResponse(res, base) {
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j.detail || j.message || ''
    } catch { /* ignore */ }
    const e = new Error(detail || `Request failed (${res.status})`)
    e.status = res.status
    throw e
  }
  return res.json()
}

async function get(base, path) {
  let res
  try {
    res = await fetch(base + path)
  } catch {
    const e = new Error(`Cannot reach the server at ${base}. Is it running?`)
    e.offline = true
    throw e
  }
  return handleResponse(res, base)
}

async function post(base, path, body) {
  let res
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    const e = new Error(`Cannot reach the server at ${base}. Is it running?`)
    e.offline = true
    throw e
  }
  return handleResponse(res, base)
}

async function postForm(base, path, formData) {
  let res
  try {
    res = await fetch(base + path, {
      method: 'POST',
      body: formData,
    })
  } catch {
    const e = new Error(`Cannot reach the server at ${base}. Is it running?`)
    e.offline = true
    throw e
  }
  return handleResponse(res, base)
}

async function del(base, path) {
  let res
  try {
    res = await fetch(base + path, { method: 'DELETE' })
  } catch {
    const e = new Error(`Cannot reach the server at ${base}. Is it running?`)
    e.offline = true
    throw e
  }
  return handleResponse(res, base)
}

const qs = (obj) =>
  new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString()

export const caseApi = {
  health: () => get(CASE_API, '/health'),
  search: (params = {}) => get(CASE_API, '/cases/search?' + qs(params)),
  survey: (no, subdivision) =>
    get(CASE_API, `/survey/${encodeURIComponent(no)}` + (subdivision ? `?${qs({ subdivision })}` : '')),
  case: (id) => get(CASE_API, `/cases/${encodeURIComponent(id)}`),
  riskAll: () => get(CASE_API, '/risk/cases'),
  riskBatch: (ids) => get(CASE_API, '/risk/batch?case_ids=' + ids.map(encodeURIComponent).join(',')),
  ollamaStatus: () => get(CASE_API, '/ollama/status'),
  summary: (id, model) => get(CASE_API, `/cases/${encodeURIComponent(id)}/summary` + (model ? `?model=${encodeURIComponent(model)}` : '')),
}

export const landApi = {
  villages: () => get(LAND_API, '/villages'),
  land: (village, survey) => get(LAND_API, `/land?${qs({ village, survey })}`),
  patta: (village, patta) => get(LAND_API, `/patta?${qs({ village, patta })}`),
  tenure: (village, surveys) => get(LAND_API, `/tenure?${qs({ village, surveys: surveys.join(',') })}`),
}

export const gisApi = {
  villages: () => get(GIS_API, '/gis/villages'),
  polygons: (slug) => (slug ? get(GIS_API, `/gis/villages/${encodeURIComponent(slug)}/polygons`) : get(GIS_API, '/gis/polygons')),
  search: (surveyNo, slug) =>
    slug
      ? get(GIS_API, `/gis/villages/${encodeURIComponent(slug)}/search/${encodeURIComponent(surveyNo)}`)
      : get(GIS_API, `/gis/search/${encodeURIComponent(surveyNo)}`),
  uploadVillage: (name, geojson) => post(GIS_API, '/gis/villages', { name, geojson }),
}

export const adminApi = {
  // Land Record Integration
  getVillagesDetailed: () => get(LAND_API, '/admin/villages-detailed'),
  uploadLandRecords: (formData) => postForm(LAND_API, '/admin/land-records/upload', formData),
  deleteVillage: (village) => del(LAND_API, `/admin/village/${encodeURIComponent(village)}`),

  // Court Case Integration
  getCaseStats: () => get(CASE_API, '/admin/stats'),
  reloadCases: () => post(CASE_API, '/admin/reload', {}),
  uploadCases: (formData) => postForm(CASE_API, '/admin/cases/upload', formData),

  // GIS Integration
  getGisVillages: () => get(GIS_API, '/gis/villages'),
  uploadGisVillage: (name, geojson) => post(GIS_API, '/gis/villages', { name, geojson }),
}

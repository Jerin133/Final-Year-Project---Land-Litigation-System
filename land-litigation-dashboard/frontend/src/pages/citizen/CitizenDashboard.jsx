import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../lib/auth.jsx'
import { landApi } from '../../lib/api.js'
import { syncTrackedCases } from '../../lib/watcher.js'
import SurveySearch from './SurveySearch.jsx'
import Hearings from './Hearings.jsx'
import Notifications from './Notifications.jsx'
import DisputeHistory from './DisputeHistory.jsx'
import { Search, Scale, Bell, ScrollText } from 'lucide-react'

const SYNC_MS = 60_000

export default function CitizenDashboard() {
  const { user, profile } = useAuth()
  const [tab, setTab] = useState('search')
  const [lang, setLang] = useState('en')
  const [villages, setVillages] = useState([])
  const [tracked, setTracked] = useState([])
  const [notifs, setNotifs] = useState([])
  const [search, setSearch] = useState({ village: '', survey: '' })
  const [banner, setBanner] = useState('')

  const loadTracked = useCallback(async () => {
    const { data } = await supabase.from('tracked_cases').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    setTracked(data || [])
  }, [user.id])

  const loadNotifs = useCallback(async () => {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
    setNotifs(data || [])
  }, [user.id])

  useEffect(() => {
    landApi.villages().then((r) => setVillages(r.villages)).catch(() => setBanner('Land-record service (port 8001) is not reachable, so village land details will not load.'))
  }, [])

  // initial load + periodic check of tracked cases + live notification feed
  useEffect(() => {
    loadTracked()
    loadNotifs()
    const run = async () => {
      const n = await syncTrackedCases(user.id)
      if (n) { loadNotifs(); loadTracked() }
    }
    run()
    const timer = setInterval(run, SYNC_MS)
    const channel = supabase
      .channel(`notifs-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => loadNotifs())
      .subscribe()
    return () => { clearInterval(timer); supabase.removeChannel(channel) }
  }, [user.id, loadTracked, loadNotifs])

  const trackedIds = useMemo(() => new Set(tracked.map((t) => t.case_id)), [tracked])
  const unread = notifs.filter((n) => !n.is_read).length

  async function track(c) {
    const { error } = await supabase.from('tracked_cases').upsert({
      user_id: user.id, case_id: c.case_id, survey_no: c.survey_no, subdivision: c.subdivision, village: c.village,
      last_status: c.status?.english ?? null, last_hearing_count: c.hearing_count ?? null,
      last_adjournment_count: c.adjournment_count ?? null, last_disposal_date: c.disposal_date ?? null,
    }, { onConflict: 'user_id,case_id' })
    if (error) return alert('Could not track this case: ' + error.message)
    await supabase.from('notifications').insert({
      user_id: user.id, case_id: c.case_id, kind: 'tracking', title: `Now tracking ${c.case_id}`,
      message: `You will be notified about hearings, adjournments and status changes for survey ${c.survey_no}${c.subdivision ? '/' + c.subdivision : ''}.`,
    })
    loadTracked()
    loadNotifs()
  }

  async function untrack(caseId) {
    await supabase.from('tracked_cases').delete().eq('user_id', user.id).eq('case_id', caseId)
    loadTracked()
  }

  async function markRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    loadNotifs()
  }
  async function markAllRead() {
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    loadNotifs()
  }
  async function deleteNotif(id) {
    await supabase.from('notifications').delete().eq('id', id)
    loadNotifs()
  }

  const tabs = [
    ['search',        <Search size={14} />,    'Search Survey'],
    ['hearings',      <Scale size={14} />,     `Track Hearings${tracked.length ? ` (${tracked.length})` : ''}`],
    ['notifications', <Bell size={14} />,      `Notifications${unread ? ` (${unread})` : ''}`],
    ['history',       <ScrollText size={14} />, 'Dispute History'],
  ]

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1>Citizen Portal</h1>
          <p className="muted">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}. Case information shown is synthetic demonstration data.</p>
        </div>
      </div>
      {banner && <div className="alert alert-warn">{banner}</div>}
      <div className="tabs">
        {tabs.map(([k, icon, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <SurveySearch villages={villages} lang={lang} setLang={setLang} trackedIds={trackedIds} onTrack={track} onUntrack={untrack}
          search={search} setSearch={setSearch} />
      )}
      {tab === 'hearings' && <Hearings tracked={tracked} lang={lang} setLang={setLang} onUntrack={untrack} goSearch={() => setTab('search')} />}
      {tab === 'notifications' && (
        <Notifications items={notifs} onRead={markRead} onReadAll={markAllRead} onDelete={deleteNotif} />
      )}
      {tab === 'history' && <DisputeHistory villages={villages} lang={lang} setLang={setLang} search={search} setSearch={setSearch} />}
    </div>
  )
}

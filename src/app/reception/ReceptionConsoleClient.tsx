'use client'

import { useEffect, useRef, useState } from 'react'
import AppShell from '@/components/layout/AppShell'

type Item = {
  id: string; status: string; visitor: string; phone: string | null; email: string | null; lang: string
  motif: string | null; motif_color: string | null; section: string | null
  waiting_since: string | null; note: string | null
  handled_by: string | null; handler: string | null; mine: boolean
  mission: { number: number | null; plate: string | null; vehicle: string | null; zone: string | null } | null
  serviceSec: number | null
}
type Staff = { id: string; name: string }

function ago(iso: string | null, now: number): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  const m = Math.floor(s / 60)
  return m < 1 ? "à l'instant" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function ReceptionConsoleClient({ meName }: { meName: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [priv, setPriv]   = useState(false)
  const [staff, setStaff] = useState<Staff[]>([])
  const [meId, setMeId]   = useState('')
  const [handling, setHandling] = useState<Item | null>(null)
  const [note, setNote]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [pickUser, setPickUser] = useState(false)
  const [now, setNow]     = useState(() => Date.now())
  const [loaded, setLoaded] = useState(false)
  const hRef = useRef<string | null>(null)
  hRef.current = handling?.id || null

  async function load() {
    try {
      const r = await fetch('/api/reception/queue', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) return
      setItems(j.items || []); setPriv(!!j.priv); setStaff(j.staff || []); setMeId(j.me || '')
      // Synchronise le panneau ouvert avec les données fraîches.
      if (hRef.current) {
        const cur = (j.items || []).find((x: Item) => x.id === hRef.current)
        if (!cur || cur.status === 'done' || cur.handled_by !== j.me) setHandling(null)
        else setHandling(cur)
      }
    } catch {} finally { setLoaded(true) }
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    const c = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(t); clearInterval(c) }
  }, [])

  async function act(action: string, id: string, extra: any = {}) {
    setBusy(true)
    try {
      const r = await fetch('/api/reception/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, ...extra }),
      })
      return r.ok
    } catch { return false } finally { setBusy(false) }
  }

  async function claim(it: Item) {
    if (await act('claim', it.id)) { setNote(it.note || ''); setHandling({ ...it, status: 'in_progress', handled_by: meId, mine: true }); await load() }
  }
  async function complete() {
    if (!handling) return
    if (await act('complete', handling.id, { note: note.trim() || null })) { setHandling(null); setNote(''); await load() }
  }
  async function reassign(userId: string) {
    if (!handling) return
    if (await act('reassign', handling.id, { user_id: userId })) { setPickUser(false); setHandling(null); await load() }
  }

  const waiting = items.filter(i => i.status === 'waiting')
  const inProg  = items.filter(i => i.status === 'in_progress')

  const dot = (c: string | null) => <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c || '#cbd5e1' }} />

  return (
    <AppShell title="Réception">
      <main className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-ink text-2xl font-bold flex-1">🛎️ Réception — file d'attente</h1>
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300 font-semibold">● en direct · {waiting.length} en attente</span>
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* File d'attente */}
          <section className="bg-surface border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-surface-2 font-bold text-ink text-sm">En attente ({waiting.length})</div>
            <div className="divide-y">
              {!waiting.length && <div className="p-8 text-center text-ink-muted text-sm">{loaded ? 'Personne en attente 🎉' : '…'}</div>}
              {waiting.map(it => (
                <div key={it.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">{dot(it.motif_color)}<span className="font-semibold text-ink truncate">{it.visitor}</span>
                      {it.lang === 'en' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border text-ink-faint">EN</span>}</div>
                    <div className="text-ink-muted text-xs mt-0.5 truncate">
                      {it.motif || '—'}{it.mission ? ` · ${it.mission.plate || ''} ${it.mission.vehicle || ''}` : ''}{it.mission?.number ? ` · #${it.mission.number}` : ''}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-300 font-semibold whitespace-nowrap">{ago(it.waiting_since, now)}</span>
                  <button onClick={() => claim(it)} disabled={busy}
                    className="px-3.5 py-2 bg-brand text-white rounded-xl text-sm font-bold disabled:opacity-50 whitespace-nowrap">Je prends</button>
                </div>
              ))}
            </div>
          </section>

          {/* En cours */}
          <section className="bg-surface border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-surface-2 font-bold text-ink text-sm">En cours ({inProg.length})</div>
            <div className="divide-y">
              {!inProg.length && <div className="p-8 text-center text-ink-muted text-sm">Aucun visiteur en cours de traitement.</div>}
              {inProg.map(it => (
                <div key={it.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">{dot(it.motif_color)}<span className="font-semibold text-ink truncate">{it.visitor}</span></div>
                    <div className="text-ink-muted text-xs mt-0.5 truncate">{it.motif || '—'} · <span className="text-emerald-600 font-semibold">{it.handler}</span>{priv && it.serviceSec != null ? ` · ⏱ ${fmtSec(it.serviceSec)}` : ''}</div>
                  </div>
                  {it.mine && <button onClick={() => { setNote(it.note || ''); setHandling(it) }}
                    className="px-3 py-1.5 bg-surface-2 border rounded-lg text-xs font-semibold">Ouvrir</button>}
                </div>
              ))}
            </div>
          </section>
        </div>
        <p className="text-ink-faint text-xs">Le pop-up de traitement ne se ferme qu'avec « Enregistrer ». Chrono de service masqué {priv ? '(visible pour toi, superadmin)' : ''}.</p>
      </main>

      {/* Panneau de traitement VERROUILLÉ (pas de fermeture au clic-fond) */}
      {handling && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4">
          <div className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🛎️</span>
              <h3 className="text-ink font-bold text-base flex-1">Traitement — {handling.visitor}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 border text-ink-faint">🔒</span>
            </div>

            <div className="text-sm text-ink-secondary flex items-center gap-2">{dot(handling.motif_color)} {handling.motif || '—'}
              {handling.lang === 'en' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border">EN</span>}</div>

            {handling.mission && (
              <div className="bg-surface-2 border rounded-xl p-3 text-sm">
                <div className="font-bold text-brand">#{handling.mission.number ?? '—'}</div>
                <div className="text-ink-muted text-xs">{[handling.mission.vehicle, handling.mission.plate, handling.mission.zone ? `Zone ${handling.mission.zone}` : null].filter(Boolean).join(' · ')}</div>
              </div>
            )}
            {(handling.phone || handling.email) && (
              <div className="text-xs text-ink-muted">{[handling.phone, handling.email].filter(Boolean).join(' · ')}</div>
            )}

            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Remarque (ex. « a récupéré GPS + papiers, signé décharge »)"
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />

            <button onClick={complete} disabled={busy}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">✅ Enregistrer — fin d'intervention (visiteur parti)</button>

            <div className="flex items-center justify-between">
              <span className="text-ink-faint text-xs">Pris par {meName}</span>
              <button onClick={() => setPickUser(v => !v)} className="text-xs text-ink-secondary underline">🙋 Ce n'est pas moi</button>
            </div>
            {pickUser && (
              <div className="border rounded-xl divide-y max-h-52 overflow-y-auto">
                {staff.filter(s => s.id !== meId).map(s => (
                  <button key={s.id} onClick={() => reassign(s.id)} disabled={busy}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">{s.name}</button>
                ))}
                {!staff.length && <div className="px-3 py-2 text-xs text-ink-faint">Aucun autre agent.</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}

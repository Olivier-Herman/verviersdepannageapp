'use client'

import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import { createClient }        from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

const FRESH_MINUTES = 30   // Olivier 2026-06-18 : fenêtre Momo Market portée à 30 min
// Statuts visibles sur l'étal : "En commande" (new) + "En attente" (dispatching).
const ELIGIBLE_STATUSES = ['new', 'dispatching']

interface Mission {
  id:              string
  mission_number:  number | null
  source:          string | null
  mission_type:    string | null
  status:          string
  vehicle_plate:   string | null
  vehicle_brand:   string | null
  vehicle_model:   string | null
  incident_address:string | null
  incident_city:   string | null
  client_name:     string | null
  received_at:     string
  remarks_general: string | null
}

function fmtSource(s: string | null): string {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtAge(iso: string, now: number): string {
  const ageMin = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (ageMin <= 0) return "à l'instant"
  if (ageMin === 1) return "il y a 1 min"
  return `il y a ${ageMin} min`
}

export default function SelfServiceClient({ initialMissions, currentUserId }: { initialMissions: Mission[]; currentUserId: string }) {
  const router = useRouter()
  const [missions, setMissions] = useState<Mission[]>(initialMissions)
  const [now, setNow]           = useState<number>(Date.now())
  const [busyId, setBusyId]     = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  // Tick toutes les 10s pour le countdown + auto-cleanup > 30 min
  useEffect(() => {
    const tick = () => {
      setNow(Date.now())
      setMissions(ms => ms.filter(m => (Date.now() - new Date(m.received_at).getTime()) <= FRESH_MINUTES * 60 * 1000))
    }
    const id = setInterval(tick, 10_000)
    return () => clearInterval(id)
  }, [])

  // Realtime : nouvelles missions OR assignation par un autre → retire
  useEffect(() => {
    const ch = sb.channel('missions-dispo-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incoming_missions' }, payload => {
        if (payload.eventType === 'INSERT') {
          const m = payload.new as any
          if (ELIGIBLE_STATUSES.includes(m.status) && !m.assigned_to && m.source !== 'garage' && m.source !== 'unknown') {
            setMissions(prev => prev.some(x => x.id === m.id) ? prev : [m, ...prev])
          }
        } else if (payload.eventType === 'UPDATE') {
          const m = payload.new as any
          // Le placeholder est inséré en source='unknown' puis enrichi à l'UPDATE
          // (source réelle + données parsées). On (re)joue donc l'éligibilité ici :
          // mission fraîche + correctement sourcée → ajout/refresh ; sinon retrait.
          const fresh = (Date.now() - new Date(m.received_at).getTime()) <= FRESH_MINUTES * 60 * 1000
          const eligible = ELIGIBLE_STATUSES.includes(m.status) && !m.assigned_to
            && m.source !== 'garage' && m.source !== 'unknown' && fresh
          if (!eligible) {
            setMissions(prev => prev.filter(x => x.id !== m.id))
          } else {
            setMissions(prev => prev.some(x => x.id === m.id)
              ? prev.map(x => (x.id === m.id ? { ...x, ...m } : x))
              : [m, ...prev])
          }
        }
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])

  async function claim(id: string) {
    setBusyId(id); setError(null)
    try {
      const res = await fetch(`/api/missions/${id}/claim`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      // Mission prise → redirect vers la fiche
      router.replace(`/mission/${id}`)
    } catch (e: any) {
      setError(e?.message || 'Erreur')
      setMissions(prev => prev.filter(x => x.id !== id))  // probablement deja prise par autre
    } finally { setBusyId(null) }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-ink font-bold text-xl">🛒 Momo Market</h1>
        <p className="text-ink-muted text-sm mt-1">
          Missions fraîches sur l&apos;étal — arrivées dans les <strong>{FRESH_MINUTES} dernières minutes</strong>, non encore attribuées.
          Clique sur « Je la prends » pour te l&apos;assigner.
        </p>
        <p className="text-ink-faint text-xs mt-1">
          ⚠️ Si le dispatch t&apos;a déjà appelé pour une mission spécifique, prends-la avant qu&apos;un autre chauffeur ne l&apos;attribue.
        </p>
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">⚠️ {error}</p>}

      {missions.length === 0 ? (
        <div className="bg-surface border rounded-2xl p-10 text-center">
          <div className="text-5xl mb-3">⏳</div>
          <p className="text-ink font-semibold">Aucune mission disponible pour le moment</p>
          <p className="text-ink-muted text-sm mt-1">Les missions apparaissent automatiquement dès qu&apos;elles arrivent.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {missions.map(m => (
            <li key={m.id} className="bg-surface border-2 border-brand/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="bg-brand text-white text-xs font-bold px-2 py-0.5 rounded">{fmtSource(m.source)}</span>
                    {m.mission_type === 'depannage'  && <span className="text-xs text-ink-muted font-semibold">🔧 DSP</span>}
                    {m.mission_type === 'remorquage' && <span className="text-xs text-ink-muted font-semibold">🚛 REM</span>}
                    <span className="text-ink-faint text-xs ml-auto">{fmtAge(m.received_at, now)}</span>
                  </div>
                  <p className="text-ink font-bold text-base">
                    {m.client_name || 'Client'}
                  </p>
                  {(m.vehicle_plate || m.vehicle_brand) && (
                    <p className="text-ink-secondary text-sm mt-0.5">
                      {m.vehicle_plate && <span className="font-mono font-bold">{m.vehicle_plate}</span>}
                      {(m.vehicle_brand || m.vehicle_model) && <span> · {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}</span>}
                    </p>
                  )}
                  {m.incident_address && (
                    <p className="text-ink-muted text-xs mt-1">📍 {m.incident_address}{m.incident_city ? `, ${m.incident_city}` : ''}</p>
                  )}
                  {m.remarks_general && (
                    <p className="text-ink-faint text-xs mt-1 italic line-clamp-2">{m.remarks_general}</p>
                  )}
                </div>
              </div>
              <button onClick={() => claim(m.id)} disabled={busyId === m.id}
                className="w-full py-3 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white font-bold rounded-xl text-sm">
                {busyId === m.id ? '⏳ Attribution…' : '🚗 Je la prends'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

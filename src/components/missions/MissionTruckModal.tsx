'use client'

// Mission attribuée au chauffeur sans camion (Olivier 26/10/2026, maquette validée) : la fiche lui demande avec
// quel camion il fait la mission. Pas de fermeture : la mission ne peut pas avancer sans camion. Son camion du
// moment est présélectionné ; le camion choisi le devient.

import { useEffect, useState } from 'react'
import { T } from '@/lib/i18n/T'
import { useT } from '@/lib/i18n/I18nProvider'
import SignalerErreur from '@/components/SignalerErreur'

type Truck = { id: string; name: string; plate: string; brand?: string | null; model?: string | null; used_by: string | null }

export default function MissionTruckModal({ missionId, onDone, onSkip }: { missionId: string; onDone: (truckId: string) => void; onSkip: () => void }) {
  const { t } = useT()
  const [trucks, setTrucks] = useState<Truck[] | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/missions/${missionId}/truck`, { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (!alive) return
      if (j.truck_id) { onDone(j.truck_id); return }   // posé entre-temps (dispatch, autre écran)
      setTrucks(j.trucks || []); setCurrent(j.current_truck_id || null)
      setPick((j.trucks || []).some((x: Truck) => x.id === j.current_truck_id) ? j.current_truck_id : null)
    }).catch(() => { if (alive) { setTrucks([]); setErr(t('truck_mission.error')) } })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId])

  async function confirmer() {
    if (!pick) return
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/missions/${missionId}/truck`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ truck_id: pick }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || t('truck_mission.error'))
      onDone(j.truck_id || pick)
    } catch (e: any) { setErr(e.message || t('truck_mission.error')) } finally { setBusy(false) }
  }

  // Le camion du moment en premier, puis l'ordre du parc.
  const liste = (trucks || []).slice().sort((a, b) => (a.id === current ? -1 : b.id === current ? 1 : 0))

  return (
    <div className="fixed inset-0 z-[350] flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="truck-mission-title">
      <div className="w-full max-w-md space-y-3 rounded-t-3xl bg-white p-4 text-gray-900 sm:rounded-3xl dark:bg-slate-800 dark:text-slate-100"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="flex gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-amber-100 text-2xl">🚛</div>
          <div className="rounded-2xl rounded-tl-sm bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
            <b id="truck-mission-title"><T k="truck_mission.title" /></b><br /><T k="truck_mission.text" />
          </div>
        </div>

        {trucks === null ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map(i => <div key={i} className="h-[52px] animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-700" />)}
          </div>
        ) : liste.length === 0 ? (
          <>
            <p className="rounded-xl bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-900"><T k="truck_mission.none" /></p>
            {/* Aucun camion à choisir : on ne bloque pas la mission. */}
            <button type="button" onClick={onSkip} className="min-h-[48px] w-full rounded-2xl bg-gray-100 font-semibold text-gray-800 dark:bg-slate-700 dark:text-slate-100"><T k="signaler.close" /></button>
          </>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {liste.map(x => (
              <button key={x.id} type="button" onClick={() => setPick(x.id)} aria-pressed={pick === x.id}
                className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-2 text-left ${pick === x.id ? 'border-teal-600 bg-teal-50 dark:bg-teal-950' : 'border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-800'}`}>
                <span>
                  <span className="block font-bold text-gray-900 dark:text-slate-100">{x.name} · <span className="font-mono">{x.plate}</span></span>
                  {(x.brand || x.model) && <span className="block text-xs text-gray-700 dark:text-slate-300">{[x.brand, x.model].filter(Boolean).join(' ')}</span>}
                </span>
                <span className="text-right text-xs font-semibold text-gray-700 dark:text-slate-300">
                  {x.id === current ? t('truck_mission.current') : x.used_by ? t('truck_mission.used_by', { name: x.used_by }) : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        {err && <p className="text-sm font-semibold text-red-700 dark:text-red-300">⚠️ {err}<SignalerErreur message={err} where="action" missionId={missionId} /></p>}

        <button type="button" onClick={confirmer} disabled={!pick || busy}
          className="min-h-[52px] w-full rounded-2xl bg-blue-700 font-bold text-white disabled:opacity-50">
          {busy ? <T k="truck_mission.saving" /> : <T k="truck_mission.confirm" />}
        </button>
        <p className="text-xs text-gray-700 dark:text-slate-300"><T k="truck_mission.note" /></p>
      </div>
    </div>
  )
}

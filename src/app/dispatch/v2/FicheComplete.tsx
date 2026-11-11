'use client'
// Fiche complète embarquée dans le nouveau Dispatch (préversion dispatch_v2).
// On reprend la fiche actuelle TELLE QUELLE (MissionDetailClient en mode embarqué, comme la
// page dossier) : tous ses blocs et toutes ses actions restent disponibles, rien n'est réécrit.
// Grand volet par-dessus la page ; fermeture par le ✕ uniquement.

import { useEffect, useState } from 'react'
import MissionDetailClient from '@/app/dispatch/[id]/MissionDetailClient'
import { onMissionChanged } from '@/lib/missions/changed-event'
import type { SourceDisplay } from '@/lib/missions/source-display'

export default function FicheComplete({ missionId, titre, drivers, sources, onFermer }: {
  missionId: string; titre: string; drivers: any[]; sources: SourceDisplay[]; onFermer: () => void
}) {
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cle, setCle] = useState(0)
  useEffect(() => {
    let annule = false
    if (cle === 0) { setData(null); setErr(null) }
    fetch(`/api/missions/${missionId}/fiche?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (annule) return; if (j?.ok) setData(j); else setErr(j?.error || 'Chargement impossible') })
      .catch(e => { if (!annule) setErr(String(e?.message || e)) })
    return () => { annule = true }
  }, [missionId, cle])
  // Une action dans la fiche (mise en parc, affectation…) → rechargement silencieux.
  useEffect(() => onMissionChanged(id => { if (id === missionId) setCle(k => k + 1) }), [missionId])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <div role="dialog" aria-modal="true" aria-label={`Fiche complète ${titre}`} className="h-full w-full lg:w-[min(1180px,94vw)] bg-page shadow-2xl flex flex-col">
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-surface">
          <b className="text-[16px] text-ink">Fiche complète · {titre}</b>
          <button type="button" onClick={onFermer} aria-label="Fermer la fiche complète" className="w-11 h-11 rounded-xl border border-stone-200 bg-white text-stone-900 text-lg">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {err ? <p className="p-4 text-red-700 font-semibold">La fiche n'a pas pu être chargée ({err}).</p>
            : !data ? <p className="p-4 text-stone-500">Chargement de la fiche…</p>
            : (
              <MissionDetailClient
                mission={data.fiche.mission} logs={data.fiche.logs} drivers={drivers} sources={sources as any}
                linkedParent={data.fiche.linkedParent} linkedChild={data.fiche.linkedChild}
                userName={data.user.name} userEmail={data.user.email || undefined} userId={data.user.id || undefined} userRole={data.user.role}
                userModules={data.user.modules || []} userHasOdooAccess={data.userHasOdooAccess} googleMapsKey={data.googleMapsKey}
                autoDispatchStatus={data.fiche.autoDispatchStatus} parcZoneType={data.fiche.parcZoneType} embed
              />
            )}
        </div>
      </div>
    </div>
  )
}

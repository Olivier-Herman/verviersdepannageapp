'use client'
// Bouton discret en bas de « Mes Missions » → ouvre la liste des missions
// clôturées il y a moins de 6h dont le chauffeur peut encore modifier la clôture.
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ClosedMission = {
  id: string
  mission_number: number | null
  dossier_number: string | null
  external_id: string | null
  client_name: string | null
  vehicle_plate: string | null
}

export default function ReopenClosureButton({ missions }: { missions: ClosedMission[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  if (!missions || missions.length === 0) return null

  const ref = (m: ClosedMission) =>
    m.mission_number != null ? `#${m.mission_number}` : (m.dossier_number || m.external_id || '—')

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full mt-2 py-3 rounded-2xl border border-amber-300 bg-amber-50 text-amber-800 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-amber-100 transition-colors"
      >
        ✏️ Modifier une clôture
        <span className="text-xs font-normal opacity-70">({missions.length})</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-3xl border border p-4 pb-8 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-ink font-bold text-lg">Modifier une clôture</h3>
              <button onClick={() => setOpen(false)} className="text-ink-muted text-2xl leading-none px-2">×</button>
            </div>
            <p className="text-ink-muted text-xs mb-4">
              Missions terminées il y a moins de 6h. Touche une mission pour rouvrir et corriger sa clôture.
            </p>
            <div className="space-y-2">
              {missions.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setOpen(false); router.push(`/mission/${m.id}`) }}
                  className="w-full text-left bg-canvas border border rounded-2xl p-4 hover:border-amber-300 transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-ink-secondary text-xs font-mono">{ref(m)}</span>
                    <span className="text-amber-600 text-xs font-semibold">✏️ Modifiable</span>
                  </div>
                  <p className="text-ink font-semibold">{m.client_name || 'Client inconnu'}</p>
                  <p className="text-ink-secondary text-sm">{m.vehicle_plate}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

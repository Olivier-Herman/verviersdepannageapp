'use client'
// Un dossier = un écran. Chaque action = un GROUPE repliable qui contient TA fiche
// existante telle quelle (MissionDetailClient en mode embed = sans le menu autour).
// Dernier groupe ouvert, les autres repliés. Anté-chrono. Zéro fonction perdue.

import { useEffect, useState } from 'react'
import MissionDetailClient from '@/app/dispatch/[id]/MissionDetailClient'
import { getMissionTypeLabel } from '@/lib/missions/mission-types'

interface Group {
  letter: string; id: string; mission_number: number | null; dossier_number: string | null
  mission_type: string; status: string; started_at: string | null; data: any
}
interface Header { ref: string; vehicle: string; plate: string | null; client: string | null; phone: string | null; source: string | null }

const fmt = (v: string | null) => v ? new Date(v).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function DossierGroups({ header, groups, shared, isSuperadmin }: {
  header: Header; groups: Group[]; shared: any; isSuperadmin: boolean
}) {
  const [flagMode, setFlagMode] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => {
    const last = groups[groups.length - 1]   // le plus récent (chronologique)
    return new Set(last ? [last.letter] : [])
  })
  const toggle = (l: string) => setOpen(p => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n })

  useEffect(() => {
    if (!isSuperadmin) return
    fetch('/api/admin/feature-flags').then(r => r.json()).then(j => {
      const f = (j.flags || []).find((x: any) => x.key === 'dossier_view'); if (f) setFlagMode(f.mode)
    }).catch(() => {})
  }, [isSuperadmin])
  const setMode = async (mode: string) => {
    setFlagMode(mode)
    await fetch('/api/admin/feature-flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'dossier_view', mode }) }).catch(() => {})
  }

  const display = [...groups].reverse()   // dernière action en haut

  return (
    <div className="px-3 lg:px-6 py-5 space-y-3">

      {isSuperadmin && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2">
          <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold">🧪 Preview « Fiche dossier »</span>
          <div className="flex items-center gap-1">
            {([['off', 'Off'], ['superadmin', 'Moi'], ['all', 'Tout le monde']] as const).map(([m, lbl]) => (
              <button key={m} onClick={() => setMode(m)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${flagMode === m ? 'bg-amber-500 text-white' : 'bg-surface border text-ink-secondary hover:text-ink'}`}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {/* En-tête partagé */}
      <div className="bg-surface border rounded-2xl px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="text-ink font-bold text-lg">Dossier {header.ref}</h1>
        <span className="text-ink-secondary text-sm">{header.vehicle}{header.plate ? ` · ${header.plate}` : ''}</span>
        {header.client && <span className="text-ink-muted text-sm">· {header.client}{header.phone ? ` ${header.phone}` : ''}</span>}
        {header.source && <span className="ml-auto text-xs font-semibold text-ink-secondary bg-surface-2 border rounded-lg px-2 py-0.5">{header.source}</span>}
      </div>

      {/* Groupes = fiches réelles */}
      {display.map((g) => {
        const isOpen = open.has(g.letter)
        const idx = g.letter.charCodeAt(0) - 65
        const band = idx % 2 === 0 ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-surface'
        return (
          <div key={g.letter} className="border rounded-2xl overflow-hidden">
            <button onClick={() => toggle(g.letter)} className={`w-full flex items-center gap-3 px-4 py-3 text-left ${band} hover:brightness-95 transition`}>
              <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-ink/5 border flex items-center justify-center text-xs font-bold text-ink">-{g.letter}</span>
              <div className="flex-1 min-w-0">
                <p className="text-ink text-sm font-semibold truncate">
                  {getMissionTypeLabel(g.mission_type, 'long')} <span className="text-ink-faint font-normal">· {g.status}</span>
                </p>
                <p className="text-ink-muted text-xs truncate">
                  {g.mission_number != null ? `#${g.mission_number}` : ''}{g.dossier_number ? ` · ${g.dossier_number}` : ''}
                </p>
              </div>
              <span className="text-ink-faint text-xs flex-shrink-0">{fmt(g.started_at)}</span>
              <span className="text-ink-muted text-sm flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t bg-page">
                {/* TA fiche existante, entière et fonctionnelle */}
                <MissionDetailClient
                  mission={g.data.mission}
                  logs={g.data.logs}
                  drivers={shared.drivers}
                  sources={shared.sources}
                  linkedParent={g.data.linkedParent}
                  linkedChild={g.data.linkedChild}
                  userName={shared.userName}
                  userEmail={shared.userEmail}
                  userId={shared.userId}
                  userRole={shared.userRole}
                  userModules={shared.userModules}
                  userHasOdooAccess={shared.userHasOdooAccess}
                  googleMapsKey={shared.googleMapsKey}
                  autoDispatchStatus={g.data.autoDispatchStatus}
                  parcZoneType={g.data.parcZoneType}
                  embed
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

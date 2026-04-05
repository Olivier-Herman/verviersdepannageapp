'use client'
// src/components/missions/DriverTimeline.tsx

interface AssignedUser {
  id: string
  name?: string
  phone?: string
}

interface Mission {
  status: string
  assigned_at?: string | null
  accepted_at?: string | null
  on_way_at?: string | null
  on_site_at?: string | null
  completed_at?: string | null
  parked_at?: string | null
  delivering_at?: string | null
  assigned_user?: AssignedUser | null
}

function fmt(iso?: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString('fr-BE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const STEPS: { key: keyof Mission; label: string; icon: string; statuses?: string[] }[] = [
  { key: 'assigned_at',   label: 'Assignée',         icon: '👤' },
  { key: 'accepted_at',   label: 'Acceptée',          icon: '✅' },
  { key: 'on_way_at',     label: 'En route',          icon: '🚗' },
  { key: 'on_site_at',    label: 'Sur place',         icon: '📍' },
  { key: 'delivering_at', label: 'En livraison',      icon: '🚛', statuses: ['delivering'] },
  { key: 'parked_at',     label: 'Mis en parc',       icon: '🅿️', statuses: ['parked'] },
  { key: 'completed_at',  label: 'Terminée',          icon: '🏁' },
]

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  new:         { label: 'Nouvelle',      color: 'bg-yellow-500/20 text-yellow-400' },
  dispatching: { label: 'En attente',    color: 'bg-blue-500/20 text-blue-400' },
  assigned:    { label: 'Assignée',      color: 'bg-purple-500/20 text-purple-400' },
  accepted:    { label: 'Acceptée',      color: 'bg-indigo-500/20 text-indigo-400' },
  in_progress: { label: 'En cours',      color: 'bg-orange-500/20 text-orange-400' },
  delivering:  { label: 'En livraison',  color: 'bg-cyan-500/20 text-cyan-400' },
  parked:      { label: 'En parc',       color: 'bg-amber-500/20 text-amber-400' },
  completed:   { label: 'Terminée',      color: 'bg-green-500/20 text-green-400' },
  cancelled:   { label: 'Annulée',       color: 'bg-red-500/20 text-red-400' },
  ignored:     { label: 'Refusée',       color: 'bg-red-500/20 text-red-500' },
}

export function DriverTimeline({ mission }: { mission: Mission }) {
  const hasAny = STEPS.some(s => !!mission[s.key])
  const badge = STATUS_BADGE[mission.status]

  if (!mission.assigned_user && !hasAny) {
    return <div className="text-zinc-500 text-sm italic">Aucun chauffeur assigné</div>
  }

  // Filtrer les étapes à afficher selon le statut
  const visibleSteps = STEPS.filter(s => {
    if (!s.statuses) return true
    return s.statuses.includes(mission.status) || !!mission[s.key]
  })

  return (
    <div className="space-y-3">
      {/* Statut actuel */}
      {badge && (
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${badge.color}`}>
          {badge.label}
        </div>
      )}

      {/* Chauffeur */}
      {mission.assigned_user && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Chauffeur :</span>
          <span className="font-medium text-white">{mission.assigned_user.name ?? '—'}</span>
          {mission.assigned_user.phone && (
            <a href={`tel:${mission.assigned_user.phone}`} className="text-brand ml-1 text-xs">
              📞 {mission.assigned_user.phone}
            </a>
          )}
        </div>
      )}

      {/* Timeline */}
      <ol className="relative border-l border-[#2a2a2a] ml-2 space-y-3 pt-1">
        {visibleSteps.map(step => {
          const ts = mission[step.key] as string | null | undefined
          return (
            <li key={String(step.key)} className={`ml-4 ${ts ? '' : 'opacity-30'}`}>
              <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full text-xs ring-2 ring-[#0F0F0F] ${
                ts ? 'bg-green-500/20 text-green-400' : 'bg-[#2a2a2a] text-zinc-500'
              }`}>{step.icon}</span>
              <div className="flex items-baseline gap-2">
                <span className={`text-sm ${ts ? 'font-semibold text-white' : 'text-zinc-500'}`}>
                  {step.label}
                </span>
                {ts && <span className="text-xs text-zinc-500">{fmt(ts)}</span>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

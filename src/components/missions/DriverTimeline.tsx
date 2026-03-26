'use client'
// src/components/missions/DriverTimeline.tsx

// Note : utilise assigned_user (champ existant dans MissionDetailClient)
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
  assigned_user?: AssignedUser | null
}

function fmt(iso?: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString('fr-BE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const STEPS: { key: keyof Mission; label: string; icon: string }[] = [
  { key: 'assigned_at',  label: 'Assignée',  icon: '👤' },
  { key: 'accepted_at',  label: 'Acceptée',  icon: '✅' },
  { key: 'on_way_at',    label: 'En route',  icon: '🚗' },
  { key: 'on_site_at',   label: 'Sur place', icon: '📍' },
  { key: 'completed_at', label: 'Terminée',  icon: '🏁' },
]

export function DriverTimeline({ mission }: { mission: Mission }) {
  const hasAny = STEPS.some(s => !!mission[s.key])

  if (!mission.assigned_user && !hasAny) {
    return <div className="text-zinc-500 text-sm italic">Aucun chauffeur assigné</div>
  }

  return (
    <div className="space-y-3">
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

      <ol className="relative border-l border-[#2a2a2a] ml-2 space-y-3 pt-1">
        {STEPS.map(step => {
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

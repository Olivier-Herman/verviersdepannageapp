'use client'

import { useOnDutyPing } from '@/hooks/useOnDutyPing'

/**
 * Toggle "En service / Hors service" affiché dans la sidebar.
 * Quand activé, l'app ping la position GPS toutes les 30s pour que le
 * dispatcher voie la position en temps réel dans le modal d'assignation.
 */
export default function OnDutyToggle() {
  const { onDuty, setOnDuty, lastPing, error } = useOnDutyPing()

  return (
    <div className="px-3 py-2.5 border-t border-[#2a2a2a]">
      <button
        type="button"
        onClick={() => setOnDuty(!onDuty)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${
          onDuty
            ? 'bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20'
            : 'bg-[#111] border border-[#2a2a2a] text-zinc-400 hover:text-white hover:border-zinc-600'
        }`}
      >
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${onDuty ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'}`}></span>
          {onDuty ? 'En service' : 'Hors service'}
        </span>
        <span className={onDuty ? 'text-green-300' : 'text-zinc-500'}>
          {onDuty ? 'Cliquer pour quitter' : 'Activer'}
        </span>
      </button>
      {onDuty && lastPing && (
        <p className="text-zinc-500 text-[10px] mt-1.5 text-center">
          Position envoyée à {lastPing.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      )}
      {error && (
        <p className="text-red-400 text-[10px] mt-1.5">⚠ {error}</p>
      )}
    </div>
  )
}

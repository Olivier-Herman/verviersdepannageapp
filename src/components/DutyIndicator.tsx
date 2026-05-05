'use client'

import { useOnDutyPing } from '@/hooks/useOnDutyPing'

/**
 * Indicateur "En service / Hors service" cliquable pour activer/désactiver
 * le ping GPS qui rend le user visible dans le modal "Choisir un chauffeur"
 * du dispatcher.
 *
 * Utilise dans la carte user du Dashboard (mobile + desktop) — pas de
 * doublon, on reutilise l'emplacement deja prevu pour ce statut.
 */
export default function DutyIndicator({ compact = false }: { compact?: boolean }) {
  const { onDuty, setOnDuty, error } = useOnDutyPing()

  const dotSize    = compact ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const textClass  = compact ? 'text-xs' : 'text-sm'
  const colorClass = onDuty ? 'text-green-500' : 'text-zinc-500'
  const dotColor   = onDuty ? 'bg-green-500' : 'bg-zinc-600'

  return (
    <button
      type="button"
      onClick={() => setOnDuty(!onDuty)}
      title={onDuty ? 'Cliquer pour passer hors service' : 'Cliquer pour passer en service (envoie votre position GPS)'}
      className={`flex items-center gap-1.5 hover:opacity-80 transition ${error ? 'cursor-help' : ''}`}
    >
      <div className={`${dotSize} rounded-full ${dotColor} ${onDuty ? 'animate-pulse' : ''}`} />
      <span className={`${colorClass} ${textClass}`}>
        {onDuty ? 'En service' : 'Hors service'}
      </span>
    </button>
  )
}

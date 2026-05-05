'use client'

import { useOnDutyPing } from '@/hooks/useOnDutyPing'

/**
 * Indicateur "En service / Hors service" cliquable pour activer/désactiver
 * le ping GPS qui rend le user visible dans le modal "Choisir un chauffeur".
 *
 * Si le user est dans son planning (schedule_day 07-20 ou schedule_night
 * 17-09), le statut est verrouillé "En service" et le clic ne fait rien
 * (sauf afficher un tooltip).
 */
export default function DutyIndicator({ compact = false }: { compact?: boolean }) {
  const { onDuty, setOnDuty, isLockedByDuty } = useOnDutyPing()

  const dotSize    = compact ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const textClass  = compact ? 'text-xs' : 'text-sm'
  const colorClass = onDuty ? 'text-green-500' : 'text-zinc-500'
  const dotColor   = onDuty ? 'bg-green-500' : 'bg-zinc-600'

  const tooltip = isLockedByDuty
    ? 'Statut verrouillé par votre planning de travail'
    : (onDuty ? 'Cliquer pour passer hors service' : 'Cliquer pour passer en service')

  return (
    <button
      type="button"
      onClick={() => setOnDuty(!onDuty)}
      title={tooltip}
      disabled={isLockedByDuty && onDuty}
      className={`flex items-center gap-1.5 hover:opacity-80 transition ${isLockedByDuty ? 'cursor-help' : ''}`}
    >
      <div className={`${dotSize} rounded-full ${dotColor} ${onDuty ? 'animate-pulse' : ''}`} />
      <span className={`${colorClass} ${textClass} flex items-center gap-1`}>
        {onDuty ? 'En service' : 'Hors service'}
        {isLockedByDuty && <span className="opacity-60">🔒</span>}
      </span>
    </button>
  )
}

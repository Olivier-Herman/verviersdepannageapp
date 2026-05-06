/**
 * StatusPill — Badge spécialisé pour les statuts de mission.
 *
 * Map automatiquement un `status` (string) vers un Badge avec le bon variant,
 * emoji et label. Le mapping est centralisé dans `./mapping.ts`.
 *
 * Statuts gérés :
 *   nouveau, a_assigner, en_cours, en_route, sur_place,
 *   en_parc, a_facturer, termine, annule
 *
 * Sizes : 'sm' | 'md' (défaut: 'md') — passé au Badge sous-jacent.
 *
 * Composant pur, peut être rendu côté serveur.
 *
 * Exemple :
 *   <StatusPill status="sur_place" />          // → "📍 Sur place" (warning)
 *   <StatusPill status="a_facturer" size="sm" /> // → "💰 À facturer" (success)
 */

import { Badge, type BadgeSize } from '../Badge'
import { STATUS_MAPPING, type MissionStatus } from './mapping'

interface StatusPillProps {
  status: MissionStatus
  size?:  BadgeSize
}

export function StatusPill({ status, size = 'md' }: StatusPillProps) {
  const cfg = STATUS_MAPPING[status]
  return (
    <Badge variant={cfg.variant} size={size} leading={cfg.emoji}>
      {cfg.label}
    </Badge>
  )
}

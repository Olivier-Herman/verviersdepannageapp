// src/components/ui/StatusPill/mapping.ts
//
// Source unique de vérité pour la traduction d'un `status` mission en
// (variant Badge, emoji, label affiché). Importé par <StatusPill> et
// réutilisable ailleurs (ex: lignes de tableau, timeline, etc.).

import type { BadgeVariant } from '../Badge'

export const STATUS_MAPPING = {
  nouveau:    { variant: 'info'     as BadgeVariant, emoji: '✨', label: 'Nouveau'    },
  a_assigner: { variant: 'warning'  as BadgeVariant, emoji: '🎯', label: 'À assigner' },
  en_cours:   { variant: 'info'     as BadgeVariant, emoji: '🚐', label: 'En cours'   },
  en_route:   { variant: 'warning'  as BadgeVariant, emoji: '🛣️', label: 'En route'   },
  sur_place:  { variant: 'warning'  as BadgeVariant, emoji: '📍', label: 'Sur place'  },
  en_parc:    { variant: 'alert'    as BadgeVariant, emoji: '🅿️', label: 'En parc'    },
  a_facturer: { variant: 'success'  as BadgeVariant, emoji: '💰', label: 'À facturer' },
  termine:    { variant: 'neutral'  as BadgeVariant, emoji: '✅', label: 'Terminé'    },
  annule:     { variant: 'critical' as BadgeVariant, emoji: '❌', label: 'Annulé'     },
} as const

export type MissionStatus = keyof typeof STATUS_MAPPING

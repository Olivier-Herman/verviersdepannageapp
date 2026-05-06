/**
 * Badge — pastille sémantique courte (texte + emoji optionnel).
 *
 * Variants : 'neutral' | 'info' | 'success' | 'warning' | 'alert' | 'critical' | 'brand' | 'purple'
 * Sizes    : 'sm' | 'md' (défaut: 'md')
 *
 * - `leading` : ReactNode (emoji ou icône) affiché avant le texte
 *
 * Composant pur (pas d'événement), peut être rendu côté serveur.
 *
 * Exemple :
 *   <Badge variant="info" leading="🛡️">TOURING</Badge>
 *   <Badge variant="warning" leading="📍">Sur place</Badge>
 *   <Badge variant="critical" size="sm">⚠️ &gt;1H</Badge>
 */

import type { ReactNode } from 'react'

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'alert' | 'critical' | 'brand' | 'purple'
export type BadgeSize    = 'sm' | 'md'

interface BadgeProps {
  variant?:  BadgeVariant
  size?:     BadgeSize
  leading?:  ReactNode
  children:  ReactNode
  className?: string
}

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[10px] leading-4',
  md: 'px-2.5 py-0.5 text-[11px] leading-4',
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral:  'bg-surface-hover text-ink-secondary',
  info:     'bg-info-soft text-info',
  success:  'bg-success-soft text-success',
  warning:  'bg-warning-soft text-warning',
  alert:    'bg-alert-soft text-alert',
  critical: 'bg-critical-soft text-critical',
  brand:    'bg-brand-soft text-brand',
  purple:   'bg-purple-soft text-purple',
}

export function Badge({ variant = 'neutral', size = 'md', leading, children, className = '' }: BadgeProps) {
  const cls = [
    'inline-flex items-center gap-1 font-semibold rounded-md tracking-tight',
    SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    className,
  ].filter(Boolean).join(' ')

  return (
    <span className={cls}>
      {leading !== undefined && <span aria-hidden="true">{leading}</span>}
      {children}
    </span>
  )
}

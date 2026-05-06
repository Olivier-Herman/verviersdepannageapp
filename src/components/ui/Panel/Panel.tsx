/**
 * Panel — carte avec entête optionnel (équivalent d'une "Card with header").
 *
 * Props :
 *   - `title`    : si fourni, rend un header sticky en haut
 *   - `icon`     : ReactNode (emoji ou icône Lucide), affiché à gauche du title
 *                  dans une "section-emoji" (carré arrondi coloré)
 *   - `iconBg`   : 'info' | 'success' | 'warning' | 'alert' | 'critical' | 'purple' | 'neutral'
 *                  (couleur du fond de la section-emoji, défaut 'neutral')
 *   - `actions`  : ReactNode à droite du title (boutons, sync, +ajouter, etc.)
 *   - `noPadding`: désactive le padding 16px du body (utile pour les tableaux)
 *
 * Composant pur, peut être rendu côté serveur.
 *
 * Exemple :
 *   <Panel title="Devis" icon="💰" iconBg="success" actions={<Button size="sm">Sync</Button>}>
 *     <DevisTable />
 *   </Panel>
 *
 *   <Panel title="Photos" icon="📸" iconBg="purple">
 *     <PhotoGrid />
 *   </Panel>
 */

import type { ReactNode } from 'react'

export type PanelIconBg = 'info' | 'success' | 'warning' | 'alert' | 'critical' | 'purple' | 'neutral'

interface PanelProps {
  title?:     string
  icon?:      ReactNode
  iconBg?:    PanelIconBg
  actions?:   ReactNode
  noPadding?: boolean
  className?: string
  children:   ReactNode
}

const ICON_BG_CLASSES: Record<PanelIconBg, string> = {
  neutral:  'bg-surface-hover text-ink-secondary',
  info:     'bg-info-soft text-info',
  success:  'bg-success-soft text-success',
  warning:  'bg-warning-soft text-warning',
  alert:    'bg-alert-soft text-alert',
  critical: 'bg-critical-soft text-critical',
  purple:   'bg-purple-soft text-purple',
}

export function Panel({
  title,
  icon,
  iconBg    = 'neutral',
  actions,
  noPadding = false,
  className = '',
  children,
}: PanelProps) {
  const cls = [
    'bg-surface border border-border rounded-card shadow-card overflow-hidden',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      {title !== undefined && (
        <div className="px-4 py-3 border-b border-border bg-surface flex items-center justify-between font-display font-semibold text-sm text-ink">
          <span className="flex items-center gap-2 min-w-0">
            {icon !== undefined && (
              <span
                aria-hidden="true"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-sm flex-shrink-0 ${ICON_BG_CLASSES[iconBg]}`}>
                {icon}
              </span>
            )}
            <span className="truncate">{title}</span>
          </span>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-4'}>{children}</div>
    </div>
  )
}

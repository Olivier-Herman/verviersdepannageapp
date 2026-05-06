/**
 * Avatar — pastille circulaire avec initiales et couleur déterministe.
 *
 * Sizes  : 'xs' | 'sm' | 'md' | 'lg' (défaut: 'md')
 * Status : 'available' | 'busy' | 'offline' (optionnel — affiche un dot bas-droite)
 *
 * Couleur :
 *   - 5 users core (Mobi, Jonathan, Bovy, Palm, Momo) ont une couleur fixe
 *     matchée par userId ou par prénom (cf. ./colors.ts)
 *   - Sinon : hash de `email` (préféré) ou `name` → palette de 8 gradients
 *
 * Composant pur, peut être rendu côté serveur.
 *
 * Exemple :
 *   <Avatar name="Jonathan" userId={7} size="md" status="busy" />
 *   <Avatar name="Frédéric Palm" email="palm@vd.be" size="lg" status="available" />
 */

import { getAvatarColor, getInitials } from './colors'

export type AvatarSize   = 'xs' | 'sm' | 'md' | 'lg'
export type AvatarStatus = 'available' | 'busy' | 'offline'

interface AvatarProps {
  name:       string
  email?:     string
  userId?:    string | number
  size?:      AvatarSize
  status?:    AvatarStatus
  className?: string
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-base',
}

const STATUS_DOT_SIZE: Record<AvatarSize, string> = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
}

const STATUS_BG: Record<AvatarStatus, string> = {
  available: 'bg-success-fill',
  busy:      'bg-warning-fill',
  offline:   'bg-stone-400',
}

export function Avatar({ name, email, userId, size = 'md', status, className = '' }: AvatarProps) {
  const colorClass = getAvatarColor({ userId, email, name })
  const initials   = getInitials(name)

  const cls = [
    'relative inline-flex items-center justify-center rounded-full text-white font-display font-bold flex-shrink-0 shadow-sm',
    SIZE_CLASSES[size],
    colorClass,
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      <span aria-hidden="true">{initials}</span>
      {status && (
        <span
          aria-label={`statut: ${status}`}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface ${STATUS_DOT_SIZE[size]} ${STATUS_BG[status]}`}
        />
      )}
    </div>
  )
}

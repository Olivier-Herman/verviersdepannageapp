'use client'

/**
 * Button — bouton avec hiérarchie visuelle et états standardisés.
 *
 * Variants : 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' (défaut: 'secondary')
 * Sizes    : 'sm' | 'md' | 'lg' (défaut: 'md')
 *
 * - `loading` : remplace `iconLeft` par un spinner (Loader2) et désactive le bouton
 * - `iconLeft` / `iconRight` : ReactNode (idéalement un icône Lucide)
 * - `fullWidth` : occupe toute la largeur du conteneur
 * - Hérite de tous les attributs HTML d'un `<button>` (onClick, type, form, etc.)
 *
 * Exemple :
 *   <Button variant="primary" iconLeft={<Save size={16} />}>Sauvegarder</Button>
 *   <Button variant="danger" size="sm" loading={isDeleting}>Supprimer</Button>
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize    = 'sm' | 'md' | 'lg'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?:   ButtonVariant
  size?:      ButtonSize
  loading?:   boolean
  iconLeft?:  ReactNode
  iconRight?: ReactNode
  fullWidth?: boolean
  children:   ReactNode
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-1.5 rounded-btn',
  lg: 'h-11 px-5 text-base gap-2 rounded-btn',
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-brand hover:bg-brand-hover hover:shadow-brand-hover hover:-translate-y-px',
  secondary:
    'bg-surface text-ink border border-border shadow-sm hover:bg-surface-hover hover:border-strong',
  ghost:
    'text-ink-secondary hover:bg-surface-hover',
  danger:
    'bg-surface text-critical border border-border hover:bg-critical-soft hover:border-critical',
  success:
    'bg-success-fill text-white hover:opacity-90',
}

export function Button({
  variant   = 'secondary',
  size      = 'md',
  loading   = false,
  iconLeft,
  iconRight,
  fullWidth = false,
  disabled,
  type      = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const isInactive = disabled || loading
  const cls = [
    'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
    SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    fullWidth ? 'w-full' : '',
    isInactive ? 'opacity-50 cursor-not-allowed pointer-events-none' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button {...rest} type={type} disabled={isInactive} className={cls}>
      {loading
        ? <Loader2 className="animate-spin" size={size === 'lg' ? 18 : 16} aria-hidden="true" />
        : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
}

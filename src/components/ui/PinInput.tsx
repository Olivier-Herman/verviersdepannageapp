'use client'
// src/components/ui/PinInput.tsx
//
// Champ de code PIN qui ne montre JAMAIS le chiffre tapé (Olivier 07/10/2026 : « quand Momo
// l'encode, il s'affiche en clair sur l'écran… il faudrait 4 symboles au lieu du vrai code »).
// Un champ « mot de passe » classique montre le dernier chiffre un instant sur téléphone : ici le
// vrai champ est invisible (il garde le clavier numérique), et l'écran n'affiche que des ronds
// qui se remplissent. Pas de mémorisation par le navigateur ni par un gestionnaire de mots de passe.
import { useId, type KeyboardEvent } from 'react'

export default function PinInput({
  value, onChange, length = 4, className = '', autoFocus, disabled, onKeyDown, id, ariaLabel = 'Code PIN',
}: {
  value: string
  onChange: (v: string) => void
  length?: number
  /** Classes de la boîte (bordure, fond, marges, taille du texte = taille des ronds). */
  className?: string
  autoFocus?: boolean
  disabled?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  id?: string
  ariaLabel?: string
}) {
  const uid = useId()
  return (
    <div className={`relative flex items-center justify-center ${disabled ? 'opacity-50' : ''} ${className}`}>
      <div aria-hidden className="flex items-center justify-center gap-3 pointer-events-none select-none min-h-[1.5em]">
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={`inline-block w-[0.55em] h-[0.55em] rounded-full ${i < value.length ? 'bg-current' : 'border-2 border-current opacity-30'}`} />
        ))}
      </div>
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        name={`pin-${uid}`}
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
        maxLength={length}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onKeyDown={onKeyDown}
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        style={{ caretColor: 'transparent', color: 'transparent' }}
      />
    </div>
  )
}

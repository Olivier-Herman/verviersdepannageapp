'use client'

/**
 * Input — champ texte atomique avec label, helper, états d'erreur et slots
 * d'icônes leading/trailing. Couvre 90% des cas d'inputs de l'app.
 *
 * Variants :
 *   - 'default' (défaut) : input standard, taille pilotée par `size` (sm/md/lg)
 *   - 'xl'      : saisies importantes (plaques, identifiants), text-2xl + tracking-widest + uppercase + center
 *   - 'montant' : montants en euros, text-3xl + bold + center
 *
 * Sizes (variant 'default' uniquement) :
 *   - 'sm' : px-3 py-2 text-xs
 *   - 'md' : px-3 py-2.5 text-sm  (défaut)
 *   - 'lg' : px-4 py-3 text-base
 *
 * API simplifiée : `onChange` reçoit directement la string (pas l'event complet).
 *
 * Forward ref activé : permet à AddressField de Google Places Autocomplete
 * d'attacher son ref au HTMLInputElement.
 *
 * Exemples :
 *   <Input label="Immatriculation" variant="xl" value={p} onChange={setP}
 *     placeholder="1ABC123" maxLength={9} helperText="Sans tirets" autoFocus />
 *
 *   <Input variant="montant" value={amount} onChange={setAmount}
 *     inputMode="decimal" iconTrailing={<span>€</span>} />
 *
 *   <Input label="Adresse" value={addr} onChange={setAddr}
 *     iconTrailing={<button onClick={getGPS}>📍</button>} />
 *
 *   <Input label="Email" type="email" value={email} onChange={setEmail}
 *     error={errors.email} required />
 */

import { forwardRef, type ReactNode, type Ref } from 'react'

export type InputVariant = 'default' | 'xl' | 'montant'
export type InputSize    = 'sm' | 'md' | 'lg'

export interface InputProps {
  value:         string
  onChange:      (value: string) => void
  onBlur?:       () => void
  variant?:      InputVariant
  size?:         InputSize
  type?:         'text' | 'number' | 'email' | 'tel' | 'password' | 'search'
  placeholder?:  string
  label?:        string
  helperText?:   string
  error?:        string
  disabled?:     boolean
  required?:     boolean
  iconLeading?:  ReactNode
  iconTrailing?: ReactNode
  maxLength?:    number
  autoFocus?:    boolean
  inputMode?:    'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url'
  autoComplete?: string
  name?:         string
  id?:           string
  className?:    string
  /** Classe additionnelle appliquée directement sur le `<input>` (override fin) */
  inputClassName?: string
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'px-3 py-2 text-xs',
  md: 'px-3 py-2.5 text-sm',
  lg: 'px-4 py-3 text-base',
}

/** Classes de base communes à tous les variants (couleurs, focus, transition). */
const BASE_INPUT =
  'w-full bg-surface border rounded-md text-ink ' +
  'placeholder:text-ink-muted ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft ' +
  'transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

const VARIANT_OVERRIDES: Record<InputVariant, string> = {
  default: '', // taille pilotée par SIZE_CLASSES
  xl:      'px-4 py-4 text-2xl font-bold text-center tracking-widest uppercase',
  montant: 'px-4 py-4 text-3xl font-bold text-center',
}

const ERROR_INPUT = 'border-critical focus:border-critical focus:ring-critical-soft'

export const Input = forwardRef(function Input(
  {
    value,
    onChange,
    onBlur,
    variant      = 'default',
    size         = 'md',
    type         = 'text',
    placeholder,
    label,
    helperText,
    error,
    disabled,
    required,
    iconLeading,
    iconTrailing,
    maxLength,
    autoFocus,
    inputMode,
    autoComplete,
    name,
    id,
    className,
    inputClassName,
  }: InputProps,
  ref: Ref<HTMLInputElement>,
) {
  const variantCls = variant === 'default' ? SIZE_CLASSES[size] : VARIANT_OVERRIDES[variant]
  const padLeading = iconLeading ? 'pl-10' : ''
  const padTrailing = iconTrailing ? 'pr-10' : ''

  const inputCls = [
    BASE_INPUT,
    variantCls,
    padLeading,
    padTrailing,
    error ? ERROR_INPUT : '',
    inputClassName ?? '',
  ].filter(Boolean).join(' ')

  return (
    <div className={['flex flex-col gap-1.5', className ?? ''].filter(Boolean).join(' ')}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-semibold text-ink-secondary uppercase tracking-wider"
        >
          {label}
          {required && <span className="text-critical ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}

      <div className="relative">
        {iconLeading && (
          <span
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none flex items-center"
          >
            {iconLeading}
          </span>
        )}

        <input
          ref={ref}
          id={id}
          name={name}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          maxLength={maxLength}
          autoFocus={autoFocus}
          inputMode={inputMode}
          autoComplete={autoComplete}
          aria-invalid={!!error || undefined}
          aria-describedby={error || helperText ? `${id || name || 'input'}-help` : undefined}
          className={inputCls}
        />

        {iconTrailing && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted flex items-center">
            {iconTrailing}
          </span>
        )}
      </div>

      {(error || helperText) && (
        <p
          id={`${id || name || 'input'}-help`}
          className={`text-xs ${error ? 'text-critical' : 'text-ink-muted'}`}
        >
          {error || helperText}
        </p>
      )}
    </div>
  )
})

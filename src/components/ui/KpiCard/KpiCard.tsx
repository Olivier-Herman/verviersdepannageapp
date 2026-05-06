'use client'

/**
 * KpiCard — bloc compteur avec gros chiffre, label en uppercase et sous-titre.
 *
 * Props :
 *   - `label`   : string (uppercase, petit, en haut)
 *   - `value`   : string | number (le chiffre principal en gros, font-display)
 *   - `sub`     : string optionnel (sous-titre sous le chiffre)
 *   - `icon`    : emoji optionnel placé à côté du label
 *   - `active`  : true → fond gradient rouge marque + texte blanc
 *   - `onClick` : si fourni, la card devient cliquable (button) avec hover
 *   - `minWidth`: width min CSS (défaut '130px') — utile dans les rangées scrollables
 *
 * Hover (si onClick) : translateY -2px + shadow-md.
 *
 * Exemple :
 *   <KpiCard label="🆕 Nouveau" value={3} sub="missions à confirmer" active />
 *   <KpiCard label="En parc" value={45} icon="🅿️" onClick={() => setTab('parc')} />
 */

interface KpiCardProps {
  label:     string
  value:     string | number
  sub?:      string
  icon?:     string
  active?:   boolean
  onClick?:  () => void
  minWidth?: string
  className?: string
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  active   = false,
  onClick,
  minWidth = '130px',
  className = '',
}: KpiCardProps) {
  const baseCls = 'flex flex-col items-start p-3.5 rounded-card border transition-all duration-150 text-left'
  const skinCls = active
    ? 'bg-gradient-to-br from-brand to-brand-hover border-brand-hover text-white shadow-md'
    : 'bg-surface border-border'
  const hoverCls = onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : ''

  const labelCls = active ? 'text-white/85'   : 'text-ink-muted'
  const valueCls = active ? 'text-white'      : 'text-ink'
  const subCls   = active ? 'text-white/75'   : 'text-ink-muted'

  const cls = [baseCls, skinCls, hoverCls, className].filter(Boolean).join(' ')

  const inner = (
    <>
      <div className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1 ${labelCls}`}>
        {icon && <span aria-hidden="true">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className={`font-display text-[28px] font-extrabold leading-none tracking-tight mt-1 ${valueCls}`}>
        {value}
      </div>
      {sub && <div className={`text-[11px] mt-1 ${subCls}`}>{sub}</div>}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ minWidth }} className={cls}>
        {inner}
      </button>
    )
  }
  return (
    <div style={{ minWidth }} className={cls}>
      {inner}
    </div>
  )
}

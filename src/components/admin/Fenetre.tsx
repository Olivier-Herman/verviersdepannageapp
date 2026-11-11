'use client'

// Fenêtres d'ajout et de modification des écrans de Réglages (Olivier 11/11/2026, maquette
// « Nouveau tarif » validée : https://claude.ai/artifact/691RdVeV3wwexScKXUZaSo).
// En-tête de la couleur de la rubrique avec une croix, étapes numérotées, grands champs avec
// l'unité écrite dedans, choix d'un appui, boutons toujours visibles en bas. Plein écran sur
// téléphone, centrée sur grand écran. Jamais de fermeture au clic sur le fond (règle d'Olivier).

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, Check } from 'lucide-react'
import { DEGRADE, type Couleur } from '@/lib/admin/reglages-visuel'

const champCls = 'w-full min-h-[52px] rounded-2xl bg-surface-hover/60 border border-strong px-4 text-ink text-base outline-none focus:border-ink-faint focus:bg-surface'

export function Fenetre({ titre, sousTitre, couleur = 'info', icone, onClose, pied, children, large = false }: {
  titre: string
  sousTitre?: string
  couleur?: Couleur
  icone?: ReactNode
  onClose: () => void
  pied: ReactNode
  children: ReactNode
  large?: boolean
}) {
  // Le fond ne défile pas derrière la fenêtre. Rendue dans <body> : sinon elle reste prise dans
  // la zone de contenu et passe sous la barre du haut de l'app.
  const [monte, setMonte] = useState(false)
  useEffect(() => {
    setMonte(true)
    const avant = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = avant }
  }, [])
  if (!monte) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/55 flex items-stretch sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={titre}>
      <div className={`fenetre-reglages w-full ${large ? 'sm:max-w-4xl' : 'sm:max-w-2xl'} h-full sm:h-auto sm:max-h-[92vh] bg-surface sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col`}>
        <header className={`relative flex items-center gap-4 px-5 py-4 sm:py-5 pt-[max(1rem,env(safe-area-inset-top))] text-white bg-gradient-to-br ${DEGRADE[couleur]}`}>
          {icone && <span className="w-12 h-12 rounded-2xl flex items-center justify-center bg-white/20 ring-1 ring-white/30 flex-shrink-0">{icone}</span>}
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-xl sm:text-2xl leading-tight truncate">{titre}</h2>
            {sousTitre && <p className="text-white/90 text-sm mt-0.5">{sousTitre}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 flex-shrink-0">
            <X size={22} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">{children}</div>
        <footer className="border-t border-strong px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3 bg-surface">{pied}</footer>
      </div>
    </div>,
    document.body,
  )
}

export function BoutonsPied({ onAnnuler, onValider, libelle, enCours = false, couleur = 'info', desactive = false }: {
  onAnnuler: () => void; onValider: () => void; libelle: string; enCours?: boolean; couleur?: Couleur; desactive?: boolean
}) {
  return (
    <>
      <button type="button" onClick={onAnnuler} disabled={enCours}
        className="min-h-[52px] px-6 rounded-2xl bg-surface border border-strong text-ink font-semibold hover:border-ink-faint disabled:opacity-50">
        Annuler
      </button>
      <button type="button" onClick={onValider} disabled={enCours || desactive}
        className={`flex-1 min-h-[52px] px-6 rounded-2xl text-white font-bold bg-gradient-to-br shadow-md hover:brightness-105 disabled:opacity-50 ${DEGRADE[couleur]}`}>
        {enCours ? 'Enregistrement…' : libelle}
      </button>
    </>
  )
}

export function Etape({ n, titre, children }: { n?: number; titre: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-ink font-bold text-lg">{n != null ? `${n} · ` : ''}{titre}</h3>
      {children}
    </section>
  )
}

/** Un nombre, saisi avec virgule ou point, l'unité écrite dans le champ. */
export function ChampNombre({ label, valeur, onChange, unite, placeholder }: {
  label: string; valeur: number | null | undefined; onChange: (v: number | null) => void; unite?: string; placeholder?: string
}) {
  const affiche = (v: number | null | undefined) => v == null ? '' : String(v).replace('.', ',')
  const [texte, setTexte] = useState(affiche(valeur))
  // Valeur changée de l'extérieur (autre tarif ouvert, mode changé) : on resynchronise.
  useEffect(() => {
    const n = texte.trim() === '' ? null : Number(texte.replace(',', '.'))
    if (n !== (valeur ?? null)) setTexte(affiche(valeur))
  }, [valeur]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="block rounded-2xl bg-surface-hover/60 border border-strong px-4 pt-2.5 pb-2 focus-within:border-ink-faint focus-within:bg-surface">
      <span className="block text-ink-muted text-xs">{label}</span>
      <span className="flex items-baseline gap-2">
        <input type="text" inputMode="decimal" value={texte} placeholder={placeholder}
          onChange={e => {
            const t = e.target.value.replace(/[^0-9.,-]/g, '')
            setTexte(t)
            const n = Number(t.replace(',', '.'))
            onChange(t.trim() === '' || !Number.isFinite(n) ? null : n)
          }}
          className="flex-1 min-w-0 bg-transparent outline-none text-ink text-2xl font-bold placeholder:text-ink-faint placeholder:font-normal placeholder:text-lg py-1" />
        {unite && <span className="text-ink-muted font-semibold text-sm whitespace-nowrap">{unite}</span>}
      </span>
    </label>
  )
}

export function ChampTexte({ label, valeur, onChange, placeholder, aide, grand = false }: {
  label: string; valeur: string | null | undefined; onChange: (v: string) => void; placeholder?: string; aide?: string; grand?: boolean
}) {
  return (
    <div>
      <label className="block rounded-2xl bg-surface-hover/60 border border-strong px-4 pt-2.5 pb-2 focus-within:border-ink-faint focus-within:bg-surface">
        <span className="block text-ink-muted text-xs">{label}</span>
        <input type="text" value={valeur || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className={`w-full bg-transparent outline-none text-ink py-1 placeholder:text-ink-faint placeholder:font-normal ${grand ? 'text-xl font-bold' : 'text-base font-semibold'}`} />
      </label>
      {aide && <p className="text-ink-muted text-sm mt-1.5 px-1">{aide}</p>}
    </div>
  )
}

export function ChampDate({ label, valeur, onChange, placeholder }: { label: string; valeur: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string }) {
  return (
    <label className="block rounded-2xl bg-surface-hover/60 border border-strong px-4 pt-2.5 pb-2 focus-within:border-ink-faint">
      <span className="block text-ink-muted text-xs">{label}{!valeur && placeholder ? <span className="text-ink-faint"> · {placeholder}</span> : null}</span>
      <input type="date" value={valeur || ''} onChange={e => onChange(e.target.value || null)}
        className="w-full bg-transparent outline-none text-ink text-lg font-bold py-1 min-h-[40px]" />
    </label>
  )
}

export function ChampTexteLong({ label, valeur, onChange, placeholder, lignes = 3 }: { label: string; valeur: string | null | undefined; onChange: (v: string) => void; placeholder?: string; lignes?: number }) {
  return (
    <label className="block rounded-2xl bg-surface-hover/60 border border-strong px-4 pt-2.5 pb-2 focus-within:border-ink-faint">
      <span className="block text-ink-muted text-xs">{label}</span>
      <textarea value={valeur || ''} onChange={e => onChange(e.target.value)} rows={lignes} placeholder={placeholder}
        className="w-full bg-transparent outline-none text-ink text-base py-1 resize-y placeholder:text-ink-faint" />
    </label>
  )
}

export function ChampListe({ label, valeur, options, onChange }: { label: string; valeur: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  // Valeur absente de la liste (ancien enregistrement) : affichée quand même, pour ne pas montrer autre chose que ce qui sera enregistré.
  const opts = options.some(o => o.value === valeur) || !valeur ? options : [{ value: valeur, label: valeur }, ...options]
  return (
    <label className="block">
      <span className="block text-ink-muted text-sm mb-1.5">{label}</span>
      <select value={valeur} onChange={e => onChange(e.target.value)} className={`${champCls} font-semibold`}>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** Choix d'un appui parmi quelques valeurs courtes. */
export function Pastilles({ label, valeur, options, onChange, couleur = 'info' }: {
  label?: string; valeur: string; options: { value: string; label: string }[]; onChange: (v: string) => void; couleur?: Couleur
}) {
  return (
    <div>
      {label && <span className="block text-ink-muted text-sm mb-1.5">{label}</span>}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(o => {
          const on = o.value === valeur
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
              className={`min-h-[46px] px-5 rounded-full text-sm font-semibold transition ${on ? `text-white bg-gradient-to-br shadow-md ${DEGRADE[couleur]}` : 'bg-surface border border-strong text-ink-secondary hover:text-ink hover:border-ink-faint'}`}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Choix d'un appui parmi des options qui demandent une explication. */
export function CartesChoix({ valeur, options, onChange, colonnes = 3 }: {
  valeur: string; options: { value: string; titre: string; desc: string }[]; onChange: (v: string) => void; colonnes?: 2 | 3
}) {
  return (
    <div role="radiogroup" className={`grid grid-cols-1 gap-2.5 ${colonnes === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {options.map(o => {
        const on = o.value === valeur
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`relative text-left rounded-2xl p-4 min-h-[88px] transition border-2 ${on ? 'border-emerald-500 bg-emerald-50' : 'border-strong bg-surface hover:border-ink-faint'}`}>
            {on && <span className="absolute right-3 top-3 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check size={15} strokeWidth={3} /></span>}
            <span className="block text-ink font-bold pr-7">{o.titre}</span>
            <span className="block text-ink-muted text-sm mt-1 leading-snug">{o.desc}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Interrupteur({ label, aide, valeur, onChange }: { label: string; aide?: string; valeur: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={valeur} onClick={() => onChange(!valeur)} className="flex items-center gap-4 text-left w-full min-h-[52px]">
      <span className={`relative w-14 h-8 rounded-full flex-shrink-0 transition-colors ${valeur ? 'bg-emerald-500' : 'bg-stone-300'}`}>
        <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${valeur ? 'left-7' : 'left-1'}`} />
      </span>
      <span>
        <span className="block text-ink font-semibold">{label}</span>
        {aide && <span className="block text-ink-muted text-sm">{aide}</span>}
      </span>
    </button>
  )
}

export function Note({ ton = 'info', children }: { ton?: 'info' | 'clair' | 'attention'; children: ReactNode }) {
  const cls = ton === 'clair' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold'
    : ton === 'attention' ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-surface-hover/60 border-strong text-ink-secondary'
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>{children}</div>
}

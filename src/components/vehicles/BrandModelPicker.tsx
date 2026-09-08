'use client'

// Sélecteur marque / modèle pour l'app chauffeur (Olivier 08/09/2026) :
//  - la liste est AU-DESSUS du champ de recherche, lui-même collé au clavier
//    (hauteur = visualViewport → jamais mangé par le clavier iOS/Android) ;
//  - le chauffeur ne crée plus JAMAIS de marque ni de modèle : quand rien ne
//    correspond, on lui propose « Autre » ; le bureau créera le véhicule.
// Le texte tapé est renvoyé avec « Autre » (onOther) pour être noté dans les
// remarques : le bureau sait ce que le chauffeur avait sous les yeux.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

export type CatalogItem = { id: number; name: string }

export const OTHER_NAME = 'Autre'
export const isOther = (name: string | null | undefined) => /^autres?(\s|$)/i.test(String(name || '').trim())
export const findOther = (items: CatalogItem[]): CatalogItem | null =>
  items.find(i => String(i.name).trim().toLowerCase() === 'autre') || items.find(i => isOther(i.name)) || null

const fold = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** Fenêtre réellement visible (au-dessus du clavier). */
function useVisualViewport() {
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const v = typeof window !== 'undefined' ? window.visualViewport : null
    if (!v) return
    const upd = () => setVv({ top: v.offsetTop, height: v.height })
    upd()
    v.addEventListener('resize', upd); v.addEventListener('scroll', upd)
    return () => { v.removeEventListener('resize', upd); v.removeEventListener('scroll', upd) }
  }, [])
  return vv
}

export default function BrandModelPicker({ open, title, items, loading, onPick, onOther, onClose }: {
  open:     boolean
  title:    string
  items:    CatalogItem[]
  loading?: boolean
  /** Une entrée du catalogue choisie. */
  onPick:   (item: CatalogItem) => void
  /** « Autre » : `typed` = ce que le chauffeur avait tapé (vide si rien). */
  onOther:  (typed: string) => void
  onClose:  () => void
}) {
  const { t } = useT()
  const [q, setQ] = useState('')
  const vv = useVisualViewport()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 50) } }, [open])
  // La liste est ancrée en bas (juste au-dessus du champ) : on la fait défiler jusqu'en bas à chaque filtre.
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight }, [q, items, open])

  const filtered = useMemo(() => {
    const k = fold(q)
    const base = items.filter(i => !isOther(i.name))
    if (!k) return base
    const starts = base.filter(i => fold(i.name).startsWith(k))
    const incl   = base.filter(i => !fold(i.name).startsWith(k) && fold(i.name).includes(k))
    return [...incl, ...starts]   // les meilleurs en bas, au plus près du pouce
  }, [items, q])

  if (!open) return null
  const style = vv ? { top: vv.top, height: vv.height } : { top: 0, height: '100dvh' }

  return (
    <div className="fixed inset-0 bg-black/60 z-[70]" onClick={onClose}>
      <div className="absolute left-0 right-0 bg-surface flex flex-col" style={style} onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-ink text-base">{title}</h2>
          <button type="button" onClick={onClose} className="text-ink-faint text-2xl leading-none px-2" aria-label={t('common.close')}>✕</button>
        </div>

        {/* Liste — au-dessus du champ, alignée en bas */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-4">
          <div className="min-h-full flex flex-col justify-end">
            {loading && <p className="text-ink-faint text-sm py-3">{t('common.loading')}</p>}
            {!loading && filtered.length === 0 && (
              <p className="text-ink-faint text-sm py-3">{q ? t('vehicle_picker.no_match') : t('vehicle_picker.empty')}</p>
            )}
            {filtered.map(i => (
              <button key={i.id} type="button" onClick={() => onPick(i)}
                className="w-full text-left py-3.5 border-t border-gray-100 text-ink text-base active:bg-surface-hover">
                {i.name}
              </button>
            ))}
          </div>
        </div>

        {/* « Autre » + recherche, collés au clavier */}
        <div className="shrink-0 border-t border-gray-100 px-4 pt-2 pb-3 space-y-2 bg-surface">
          <button type="button" onClick={() => onOther(q.trim())}
            className={`w-full text-left rounded-xl px-3 py-2.5 text-sm font-medium border ${q && filtered.length === 0 ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-surface-hover border-transparent text-ink-secondary'}`}>
            <span className="font-semibold">{OTHER_NAME}</span>
            <span className="block text-xs font-normal opacity-80">{t('vehicle_picker.other_hint')}</span>
          </button>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder={t('vehicle_picker.search')}
            autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="done"
            onKeyDown={e => { if (e.key === 'Enter') { const last = filtered[filtered.length - 1]; if (last) onPick(last); else onOther(q.trim()) } }}
            className="w-full bg-surface-hover rounded-xl px-3 py-3 text-base text-ink outline-none border border-transparent focus:border-brand" />
        </div>
      </div>
    </div>
  )
}

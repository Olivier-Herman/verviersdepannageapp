'use client'

// Palette de navigation (menu v3, lot 2 — Olivier 09/09/2026 : « une seule
// recherche »). ⌘K / Ctrl K, ou le champ du menu, ouvrent la même fenêtre :
//   - une page du menu (mêmes permissions que le menu : on ne propose que ce
//     que l'utilisateur voit) ;
//   - une plaque, un n° de fiche, un client… via la recherche globale
//     (/api/search, catégorie missions), après 2 caractères.
// ↑↓ pour choisir, Entrée pour ouvrir, Échap pour fermer. Sans résultat de page
// ni de fiche, Entrée ouvre la Recherche globale avec le texte tapé.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'
import { type NavItem } from './nav-items'
import { buildNavTree } from './nav-tree'

interface Hit { key: string; href: string; title: string; subtitle?: string; meta?: string; kind: 'page' | 'fiche' | 'raccourci' | 'recherche'; icon?: React.ReactNode }

const fold = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function NavPalette({ open, onClose, items, userRole, userModules, now = [], badges = {} }: {
  open: boolean; onClose: () => void
  items: NavItem[]; userRole: string; userModules: string[]
  now?: string[]; badges?: Record<string, number>
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [fiches, setFiches] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)

  const modules = useMemo(() => buildNavTree(items, userRole, userModules), [items, userRole, userModules])
  const pages = useMemo<Hit[]>(() => {
    const out: Hit[] = []
    for (const m of modules) {
      if (m.href) out.push({ key: m.href, href: m.href, title: m.label, kind: 'page', icon: <span className="text-base leading-none">{m.icon}</span> })
      for (const s of m.visibleSections) {
        if (s.href === m.href) continue
        const Icon = s.icon
        out.push({ key: s.href, href: s.href, title: s.label, subtitle: m.label, kind: 'page', icon: Icon ? <Icon size={15} className="opacity-70" /> : <span className="text-base leading-none">{m.icon}</span> })
      }
    }
    return out
  }, [modules])

  useEffect(() => { if (open) { setQ(''); setSel(0); setFiches([]); setTimeout(() => inputRef.current?.focus(), 30) } }, [open])

  // Fiches : recherche globale, catégorie missions, après 2 caractères, avec un léger délai.
  useEffect(() => {
    const term = q.trim()
    if (!open || term.length < 2) { setFiches([]); setLoading(false); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}&cats=mission`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (!alive) return
          const rows: any[] = j?.categories?.mission || []
          setFiches(rows.slice(0, 8).map(r => ({ key: 'm:' + r.id, href: r.href, title: r.title, subtitle: r.subtitle, meta: r.meta, kind: 'fiche', icon: <span className="text-base leading-none">🚘</span> })))
        })
        .catch(() => { if (alive) setFiches([]) })
        .finally(() => { if (alive) setLoading(false) })
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open])

  const hits = useMemo<Hit[]>(() => {
    const term = fold(q.trim())
    if (!term) {
      return now.map(h => pages.find(p => p.href === h)).filter((p): p is Hit => !!p).map(p => ({ ...p, kind: 'raccourci' as const }))
    }
    const matched = pages.filter(p => fold(p.title).includes(term) || (p.subtitle && fold(p.subtitle).includes(term)))
    const starts  = matched.filter(p => fold(p.title).startsWith(term))
    const rest    = matched.filter(p => !starts.includes(p))
    const out: Hit[] = [...starts, ...rest].slice(0, 6).concat(fiches)
    out.push({ key: 'search', href: `/recherche?q=${encodeURIComponent(q.trim())}`, title: `Chercher « ${q.trim()} » partout`, subtitle: 'Recherche globale : fiches, factures, e-mails, véhicules', kind: 'recherche', icon: <Search size={15} className="opacity-70" /> })
    return out
  }, [q, pages, fiches, now])

  useEffect(() => { setSel(0) }, [q, fiches.length])

  const go = (h: Hit) => { onClose(); router.push(h.href) }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[sel]; if (h) go(h) }
  }

  if (!open) return null
  const KIND: Record<Hit['kind'], string> = { page: 'page', fiche: 'fiche', raccourci: 'raccourci', recherche: '' }
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Aller à">
      <div className="w-full max-w-xl bg-surface border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b">
          <Search size={16} className="text-ink-muted flex-shrink-0" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Page, plaque, n° de fiche, client…" aria-label="Aller à"
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            className="flex-1 bg-transparent text-ink text-base py-3.5 outline-none placeholder:text-ink-muted" />
          {loading && <span className="text-[11px] text-ink-faint">recherche…</span>}
          <button type="button" onClick={onClose} className="text-ink-faint text-xs border rounded px-1.5 py-0.5 hover:text-ink" aria-label="Fermer">Échap</button>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5" role="listbox">
          {hits.length === 0 && <p className="px-3 py-4 text-sm text-ink-muted">Tape une page du menu, une plaque ou un numéro de fiche.</p>}
          {hits.map((h, i) => (
            <button key={h.key} type="button" role="option" aria-selected={i === sel}
              onMouseEnter={() => setSel(i)} onClick={() => go(h)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left ${i === sel ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-surface-hover'}`}>
              <span className="w-5 flex items-center justify-center flex-shrink-0">{h.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{h.title}{h.kind === 'raccourci' && badges[h.href] ? <span className="ml-2 text-[11px] font-bold text-brand">{badges[h.href]}</span> : null}</span>
                {(h.subtitle || h.meta) && <span className="block text-xs text-ink-muted truncate">{[h.subtitle, h.meta].filter(Boolean).join(' · ')}</span>}
              </span>
              {KIND[h.kind] && <span className="text-[10px] uppercase tracking-wide text-ink-faint flex-shrink-0">{KIND[h.kind]}</span>}
              {i === sel && <CornerDownLeft size={13} className="opacity-50 flex-shrink-0" />}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t text-[11px] text-ink-faint flex flex-wrap gap-x-4 gap-y-1">
          <span>↑↓ choisir</span><span>Entrée ouvrir</span><span>Échap fermer</span><span className="ml-auto">⌘K / Ctrl K depuis n'importe quel écran</span>
        </div>
      </div>
    </div>
  )
}

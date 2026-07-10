'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Search, X, Loader2, Sparkles } from 'lucide-react'
import { useSheetStack } from '@/components/sheets/SheetStackProvider'
import ScanButton from '@/components/ScanButton'

interface SearchResult {
  category: string
  id:       string
  title:    string
  subtitle: string
  meta:     string
  href:     string
  pdfUrl?:  string
}

const CATEGORY_META: Record<string, { label: string; emoji: string; color: string; accent: string }> = {
  mission:      { label: 'Missions',         emoji: '🚗', color: 'text-info',    accent: 'bg-info/15 border-info/30 text-info' },
  encaissement: { label: 'Encaissements',    emoji: '💳', color: 'text-success', accent: 'bg-success/15 border-success/30 text-success' },
  avance:       { label: 'Avances de fonds', emoji: '📄', color: 'text-warning', accent: 'bg-warning/15 border-warning/30 text-warning' },
  invoice:      { label: 'Factures',         emoji: '🧾', color: 'text-purple-500', accent: 'bg-purple-500/15 border-purple-500/30 text-purple-500' },
  vehicle:      { label: 'Véhicules',        emoji: '🚘', color: 'text-critical', accent: 'bg-critical/15 border-critical/30 text-critical' },
}

const CATEGORY_ORDER = ['mission', 'encaissement', 'avance', 'invoice', 'vehicle']

export default function GlobalSearch() {
  const router = useRouter()
  const { data: session } = useSession()
  const hasOdooAccess = !!(session?.user as any)?.hasOdooAccess
  const { openVehicle, openInvoice } = useSheetStack()
  const [open, setOpen]           = useState(false)
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<Record<string, SearchResult[]>>({})
  const [loading, setLoading]     = useState(false)
  const [total, setTotal]         = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeCats, setActiveCats]   = useState<Set<string>>(new Set())
  const [showCancelled, setShowCancelled] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<any>(null)
  const abortRef = useRef<AbortController | null>(null)

  function toggleCat(cat: string) {
    setActiveCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Lock scroll + focus input
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      document.body.style.overflow = ''
      setQuery(''); setResults({}); setTotal(0); setError(null)
      setActiveIndex(0); setActiveCats(new Set())
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Fetch debounced
  useEffect(() => {
    if (!open) return
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults({}); setTotal(0); setError(null)
      return
    }
    setLoading(true); setError(null)

    debounceRef.current = setTimeout(async () => {
      const ctl = new AbortController()
      abortRef.current = ctl
      try {
        const catsParam = activeCats.size > 0 ? `&cats=${Array.from(activeCats).join(',')}` : ''
        const cancelParam = showCancelled ? '&show_cancelled=1' : ''
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}${catsParam}${cancelParam}`, { signal: ctl.signal })
        if (!res.ok) { setError('Erreur recherche'); setResults({}); setTotal(0); return }
        const j = await res.json()
        setResults(j.categories || {})
        setTotal(j.total || 0)
        setActiveIndex(0)
      } catch (e: any) {
        if (e.name !== 'AbortError') setError(e.message || 'Erreur réseau')
      } finally {
        setLoading(false)
      }
    }, 250)
  }, [query, open, activeCats, showCancelled])

  const flatResults: SearchResult[] = []
  for (const cat of CATEGORY_ORDER) {
    const items = results[cat]
    if (items) flatResults.push(...items)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && flatResults[activeIndex]) {
      e.preventDefault()
      navigate(flatResults[activeIndex])
    }
  }

  function navigate(r: SearchResult) {
    // Sheets in-app pour vehicules et factures
    if (r.category === 'vehicle') {
      setOpen(false)
      openVehicle(parseInt(r.id, 10))
      return
    }
    if (r.category === 'invoice') {
      setOpen(false)
      openInvoice(parseInt(r.id, 10))
      return
    }
    const isExternal = /^https?:\/\//.test(r.href)
    if (isExternal) {
      window.open(r.href, '_blank', 'noopener,noreferrer')
    } else {
      setOpen(false)
      router.push(r.href)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Recherche globale (⌘K / Ctrl+K)"
        className="group flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-brand/10 to-purple-500/10 hover:from-brand/20 hover:to-purple-500/20 border border-brand/20 hover:border-brand/40 text-ink-secondary hover:text-ink transition-all text-sm shadow-sm"
      >
        <Search size={14} className="text-brand group-hover:scale-110 transition-transform" />
        <span className="hidden sm:inline">Rechercher</span>
        <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-surface border text-ink-faint font-mono">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/70 backdrop-blur-md"
          style={{ animation: 'gs-fade 150ms ease-out' }}
          onClick={() => setOpen(false)}
        >
          <style>{`
            @keyframes gs-fade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes gs-slide { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
          `}</style>
          <div
            onClick={e => e.stopPropagation()}
            className="bg-surface w-full max-w-3xl rounded-2xl border-2 border-brand/30 overflow-hidden shadow-2xl shadow-brand/20 flex flex-col"
            style={{ maxHeight: '78vh', animation: 'gs-slide 200ms ease-out' }}
          >
            {/* Bande accent au top */}
            <div className="h-1 bg-gradient-to-r from-brand via-purple-500 to-info" />

            {/* Champ de recherche */}
            <div className="flex items-center gap-3 px-5 py-4 border-b bg-gradient-to-r from-brand/5 to-transparent">
              <div className="relative flex-shrink-0">
                <Search size={20} className="text-brand" />
                {loading && (
                  <Loader2 size={20} className="absolute inset-0 text-brand animate-spin" />
                )}
              </div>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Plaque, VIN, client, adresse, date, dépanneur..."
                className="flex-1 bg-transparent text-ink text-base font-medium focus:outline-none placeholder:text-ink-faint placeholder:font-normal"
              />
              <ScanButton
                mode="any"
                value={query}
                onScan={text => { setQuery(text); inputRef.current?.focus() }}
                className="text-ink-muted hover:text-brand transition flex-shrink-0 p-1 text-lg"
                label="📷"
              />
              <button onClick={() => setOpen(false)} className="text-ink-muted hover:text-critical hover:rotate-90 transition-all duration-200 flex-shrink-0 p-1">
                <X size={18} />
              </button>
            </div>

            {/* Pills filtres */}
            <div className="px-5 py-2.5 border-b bg-surface-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-faint text-xs flex-shrink-0 mr-1">Filtres :</span>
                {CATEGORY_ORDER.map(cat => {
                  const meta = CATEGORY_META[cat]
                  const active = activeCats.has(cat)
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCat(cat)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
                        active
                          ? `${meta.accent} border-current shadow-sm scale-105`
                          : 'border bg-surface text-ink-muted hover:text-ink hover:bg-surface-hover'
                      }`}
                    >
                      <span>{meta.emoji}</span>
                      <span>{meta.label}</span>
                    </button>
                  )
                })}
                {activeCats.size > 0 && (
                  <button
                    onClick={() => setActiveCats(new Set())}
                    className="ml-auto px-2 py-1 text-xs text-ink-muted hover:text-critical transition"
                  >
                    Tout effacer
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 mt-2 text-xs text-ink-muted cursor-pointer w-fit">
                <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)}
                  className="w-3.5 h-3.5 accent-brand" />
                Afficher également les missions annulées
              </label>
            </div>

            {/* Résultats */}
            <div className="flex-1 overflow-y-auto">
              {error && (
                <div className="m-4 bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm">
                  ⚠ {error}
                </div>
              )}

              {!loading && query.trim().length >= 2 && total === 0 && !error && (
                <div className="px-4 py-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gradient-to-br from-brand/20 to-purple-500/20 flex items-center justify-center text-3xl">
                    🔍
                  </div>
                  <p className="text-ink font-medium mb-1">Aucun résultat</p>
                  <p className="text-ink-muted text-sm">pour <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded">{query}</span></p>
                </div>
              )}

              {query.trim().length < 2 && (
                <div className="px-4 py-10 text-center space-y-3">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-brand/20 via-purple-500/20 to-info/20 flex items-center justify-center text-3xl shadow-lg shadow-brand/10">
                    <Sparkles className="text-brand" />
                  </div>
                  <p className="text-ink font-medium">Recherche globale</p>
                  <p className="text-ink-muted text-sm">Tape au moins 2 caractères pour commencer.</p>
                  <div className="max-w-md mx-auto pt-2 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-ink-faint">
                      <span className="text-brand">✦</span>
                      <span>Plaque tolérante : <span className="font-mono text-ink-secondary">1ABC123</span> = <span className="font-mono text-ink-secondary">1-abc-123</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-ink-faint">
                      <span className="text-brand">✦</span>
                      <span>VIN partiel : <span className="font-mono text-ink-secondary">WBA</span> ou <span className="font-mono text-ink-secondary">123XYZ</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-ink-faint">
                      <span className="text-brand">✦</span>
                      <span>Date : <span className="font-mono text-ink-secondary">12/05</span>, <span className="font-mono text-ink-secondary">2026-05-12</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-ink-faint">
                      <span className="text-brand">✦</span>
                      <span>Filtre par catégorie en cliquant sur les pills ci-dessus</span>
                    </div>
                  </div>
                </div>
              )}

              {CATEGORY_ORDER.map(cat => {
                const items = results[cat]
                if (!items || items.length === 0) return null
                const meta = CATEGORY_META[cat]
                return (
                  <div key={cat} className="border-b last:border-b-0">
                    <div className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-surface-2 to-transparent border-b">
                      <span className="text-base">{meta.emoji}</span>
                      <span className={`text-xs font-bold uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.accent} font-medium border`}>{items.length}</span>
                    </div>
                    <ul>
                      {items.map(r => {
                        const idx = flatResults.findIndex(x => x.id === r.id && x.category === r.category)
                        const isActive = idx === activeIndex
                        return (
                          <li key={`${r.category}-${r.id}`}>
                            <div
                              onMouseEnter={() => setActiveIndex(idx)}
                              className={`flex items-stretch transition-all border-l-[3px] ${
                                isActive ? 'bg-brand/8 border-l-brand' : 'border-l-transparent hover:bg-surface-hover'
                              }`}
                            >
                              <button
                                onClick={() => navigate(r)}
                                className="flex-1 text-left px-5 py-3 min-w-0"
                              >
                                <p className="text-ink text-sm font-semibold truncate">{r.title}</p>
                                {r.subtitle && <p className="text-ink-secondary text-xs truncate mt-0.5">{r.subtitle}</p>}
                                {r.meta && <p className="text-ink-faint text-[11px] truncate mt-0.5">{r.meta}</p>}
                              </button>
                              {r.pdfUrl && (
                                <div className="flex items-center gap-1.5 pr-3">
                                  {hasOdooAccess && (
                                    <a
                                      href={r.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={() => setOpen(false)}
                                      className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-surface text-ink-secondary hover:text-ink border rounded-md whitespace-nowrap transition"
                                      title="Ouvrir dans Odoo"
                                    >
                                      Odoo
                                    </a>
                                  )}
                                  <a
                                    href={r.pdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download
                                    className="px-2.5 py-1 text-xs bg-gradient-to-r from-brand to-purple-500 hover:opacity-90 text-white rounded-md whitespace-nowrap transition shadow-sm"
                                    title="Télécharger le PDF de la facture"
                                  >
                                    📄 PDF
                                  </a>
                                </div>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 border-t bg-gradient-to-r from-surface-2 via-surface to-surface-2 flex items-center gap-3 text-xs text-ink-faint">
              <span className="hidden sm:flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded bg-surface border font-mono">↑↓</kbd> naviguer</span>
              <span className="hidden sm:flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded bg-surface border font-mono">⏎</kbd> ouvrir</span>
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded bg-surface border font-mono">Esc</kbd> fermer</span>
              <span className="flex-1" />
              {query.trim().length >= 2 && (
                <button
                  onClick={() => {
                    const q = query.trim()
                    // « Recherche plus » : bascule vers le module complet (30
                    // résultats/catégorie au lieu de 8) sur la MÊME requête et les
                    // mêmes catégories (toutes si aucune sélectionnée). Olivier 2026-07-10.
                    const cats = activeCats.size > 0 ? Array.from(activeCats).join(',') : 'all'
                    setOpen(false)
                    router.push(`/recherche?q=${encodeURIComponent(q)}&cats=${encodeURIComponent(cats)}`)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-brand/20 to-purple-500/20 hover:from-brand/35 hover:to-purple-500/35 text-brand font-bold border border-brand/40 transition"
                  title="Pas le bon résultat ? Recherche approfondie (30 résultats/catégorie, archive, Odoo, emails…)"
                >
                  🔎 Recherche plus →
                </button>
              )}
              {total > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium border border-brand/20">
                  {total} résultat{total > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

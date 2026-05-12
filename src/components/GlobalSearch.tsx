'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, Loader2 } from 'lucide-react'

interface SearchResult {
  category: string
  id:       string
  title:    string
  subtitle: string
  meta:     string
  href:     string
  pdfUrl?:  string
}

const CATEGORY_LABELS: Record<string, string> = {
  mission:      '🚗 Missions',
  encaissement: '💳 Encaissements',
  avance:       '📄 Avances de fonds',
  invoice:      '🧾 Factures Odoo',
  driver:       '🧑‍🔧 Dépanneurs',
  user:         '👤 Utilisateurs',
  vehicle:      '🚘 Véhicules Odoo',
}

const CATEGORY_ORDER = ['mission', 'encaissement', 'avance', 'invoice', 'driver', 'user', 'vehicle']

export default function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<Record<string, SearchResult[]>>({})
  const [loading, setLoading]   = useState(false)
  const [total, setTotal]       = useState(0)
  const [error, setError]       = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<any>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Cmd+K / Ctrl+K = ouvrir
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

  // Lock scroll quand ouvert + focus input
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      document.body.style.overflow = ''
      // Reset content au close
      setQuery('')
      setResults({})
      setTotal(0)
      setError(null)
      setActiveIndex(0)
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: ctl.signal })
        if (!res.ok) {
          setError('Erreur recherche')
          setResults({}); setTotal(0)
          return
        }
        const j = await res.json()
        setResults(j.categories || {})
        setTotal(j.total || 0)
        setActiveIndex(0)
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setError(e.message || 'Erreur réseau')
        }
      } finally {
        setLoading(false)
      }
    }, 250)
  }, [query, open])

  // Liste plate des résultats pour navigation clavier
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
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink transition text-sm"
      >
        <Search size={14} />
        <span className="hidden sm:inline">Rechercher</span>
        <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-surface border text-ink-faint font-mono">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-surface w-full max-w-2xl rounded-2xl border overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: '70vh' }}>

            {/* Champ de recherche */}
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Search size={18} className="text-ink-muted flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Plaque, VIN, client, adresse, date, dépanneur..."
                className="flex-1 bg-transparent text-ink text-sm focus:outline-none placeholder:text-ink-faint"
              />
              {loading && <Loader2 size={16} className="text-ink-muted animate-spin flex-shrink-0" />}
              <button onClick={() => setOpen(false)} className="text-ink-muted hover:text-ink flex-shrink-0">
                <X size={18} />
              </button>
            </div>

            {/* Résultats */}
            <div className="flex-1 overflow-y-auto">
              {error && (
                <div className="px-4 py-3 text-critical text-sm">⚠ {error}</div>
              )}
              {!loading && query.trim().length >= 2 && total === 0 && !error && (
                <div className="px-4 py-8 text-center text-ink-muted text-sm">
                  Aucun résultat pour <span className="font-mono">{query}</span>.
                </div>
              )}
              {query.trim().length < 2 && (
                <div className="px-4 py-8 text-center text-ink-muted text-sm space-y-2">
                  <p>Tape au moins 2 caractères.</p>
                  <p className="text-xs text-ink-faint">
                    Astuce : tu peux chercher par bout de plaque (<span className="font-mono">abc123</span>),
                    bout de VIN (<span className="font-mono">WBA</span>),
                    nom client, adresse, ou date (<span className="font-mono">12/05</span>, <span className="font-mono">2026-05-12</span>).
                  </p>
                </div>
              )}

              {CATEGORY_ORDER.map(cat => {
                const items = results[cat]
                if (!items || items.length === 0) return null
                return (
                  <div key={cat} className="border-b last:border-b-0">
                    <div className="px-4 py-1.5 bg-surface-2 text-ink-muted text-xs font-medium uppercase tracking-wide">
                      {CATEGORY_LABELS[cat] || cat} ({items.length})
                    </div>
                    <ul>
                      {items.map(r => {
                        const idx = flatResults.findIndex(x => x.id === r.id && x.category === r.category)
                        const isActive = idx === activeIndex
                        return (
                          <li key={`${r.category}-${r.id}`}>
                            <div
                              onMouseEnter={() => setActiveIndex(idx)}
                              className={`flex items-stretch transition border-l-2 ${
                                isActive ? 'bg-brand/10 border-l-brand' : 'border-l-transparent hover:bg-surface-hover'
                              }`}
                            >
                              <button
                                onClick={() => navigate(r)}
                                className="flex-1 text-left px-4 py-2.5 min-w-0"
                              >
                                <p className="text-ink text-sm font-medium truncate">{r.title}</p>
                                {r.subtitle && <p className="text-ink-secondary text-xs truncate">{r.subtitle}</p>}
                                {r.meta && <p className="text-ink-faint text-xs truncate">{r.meta}</p>}
                              </button>
                              {r.pdfUrl && (
                                <div className="flex items-center gap-1 pr-3">
                                  <a
                                    href={r.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setOpen(false)}
                                    className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-surface text-ink-secondary hover:text-ink border rounded-md whitespace-nowrap transition"
                                    title="Ouvrir la facture dans Odoo"
                                  >
                                    Consulter
                                  </a>
                                  <a
                                    href={r.pdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download
                                    className="px-2.5 py-1 text-xs bg-brand hover:bg-brand-hover text-white rounded-md whitespace-nowrap transition"
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
            <div className="px-4 py-2 border-t bg-surface-2 flex items-center gap-3 text-xs text-ink-faint">
              <span className="hidden sm:flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-surface border font-mono">↑↓</kbd> naviguer</span>
              <span className="hidden sm:flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-surface border font-mono">⏎</kbd> ouvrir</span>
              <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-surface border font-mono">Esc</kbd> fermer</span>
              <span className="flex-1" />
              <span>{total} résultat{total > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

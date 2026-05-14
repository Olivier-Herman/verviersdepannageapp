'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import { Search, Loader2, Sparkles, Clock, X, ExternalLink, FileText, ArrowRight } from 'lucide-react'

interface SearchResult {
  category: string
  id:       string
  title:    string
  subtitle: string
  meta:     string
  href:     string
  pdfUrl?:  string
}

const CATEGORY_META: Record<string, {
  label:   string
  emoji:   string
  gradient: string
  accent:   string
  ring:     string
  text:     string
}> = {
  mission:      { label: 'Missions',         emoji: '🚗', gradient: 'from-info/30    to-info/5',       accent: 'bg-info/15 text-info border-info/30',         ring: 'ring-info/40',     text: 'text-info' },
  encaissement: { label: 'Encaissements',    emoji: '💳', gradient: 'from-success/30 to-success/5',    accent: 'bg-success/15 text-success border-success/30', ring: 'ring-success/40',  text: 'text-success' },
  avance:       { label: 'Avances de fonds', emoji: '📄', gradient: 'from-warning/30 to-warning/5',    accent: 'bg-warning/15 text-warning border-warning/30', ring: 'ring-warning/40',  text: 'text-warning' },
  invoice:      { label: 'Factures Odoo',    emoji: '🧾', gradient: 'from-purple-500/30 to-purple-500/5', accent: 'bg-purple-500/15 text-purple-500 border-purple-500/30', ring: 'ring-purple-500/40', text: 'text-purple-500' },
  driver:       { label: 'Dépanneurs',       emoji: '🧑‍🔧', gradient: 'from-amber-500/30 to-amber-500/5',   accent: 'bg-amber-500/15 text-amber-500 border-amber-500/30',     ring: 'ring-amber-500/40',  text: 'text-amber-500' },
  user:         { label: 'Utilisateurs',     emoji: '👤', gradient: 'from-ink-faint/30 to-ink-faint/5', accent: 'bg-ink-faint/15 text-ink-secondary border-ink-faint/30',  ring: 'ring-ink-faint/40',  text: 'text-ink-secondary' },
  vehicle:      { label: 'Véhicules Odoo',   emoji: '🚘', gradient: 'from-critical/30 to-critical/5',    accent: 'bg-critical/15 text-critical border-critical/30',         ring: 'ring-critical/40',   text: 'text-critical' },
}

const CATEGORY_ORDER = ['mission', 'encaissement', 'avance', 'invoice', 'vehicle', 'driver', 'user']

const RECENT_KEY     = 'verviers:recent-searches'
const RECENT_MAX     = 8
const DEBOUNCE_MS    = 280
const MIN_LENGTH     = 2

interface Props {
  initialQuery: string
  userRole:     string
  userName:     string
  userEmail:    string
  userId:       string
  userModules:  string[]
}

function getRecent(): string[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

function pushRecent(q: string) {
  if (typeof window === 'undefined') return
  const trimmed = q.trim()
  if (trimmed.length < MIN_LENGTH) return
  const existing = getRecent().filter(x => x.toLowerCase() !== trimmed.toLowerCase())
  const next = [trimmed, ...existing].slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
}

function clearRecent() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(RECENT_KEY) } catch {}
}

export default function RechercheClient({ initialQuery, userRole, userName, userEmail, userId, userModules }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query,         setQuery]         = useState(initialQuery)
  const [results,       setResults]       = useState<Record<string, SearchResult[]>>({})
  const [loading,       setLoading]       = useState(false)
  const [total,         setTotal]         = useState(0)
  const [error,         setError]         = useState<string | null>(null)
  const [activeCats,    setActiveCats]    = useState<Set<string>>(new Set())
  const [recent,        setRecent]        = useState<string[]>([])
  const debounceRef = useRef<any>(null)
  const abortRef    = useRef<AbortController | null>(null)
  const inputRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecent(getRecent())
  }, [])

  // Autofocus + select au mount
  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus()
      if (initialQuery) inputRef.current?.select()
    }, 80)
  }, [])

  // Sync URL ?q=
  useEffect(() => {
    const url = new URL(window.location.href)
    if (query.trim()) url.searchParams.set('q', query.trim())
    else url.searchParams.delete('q')
    window.history.replaceState({}, '', url.toString())
  }, [query])

  // Fetch debounced
  useEffect(() => {
    clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    const trimmed = query.trim()
    if (trimmed.length < MIN_LENGTH) {
      setResults({}); setTotal(0); setError(null); setLoading(false)
      return
    }
    setLoading(true); setError(null)

    debounceRef.current = setTimeout(async () => {
      const ctl = new AbortController()
      abortRef.current = ctl
      try {
        const catsParam = activeCats.size > 0 ? `&cats=${Array.from(activeCats).join(',')}` : ''
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&full=1${catsParam}`, { signal: ctl.signal })
        if (!res.ok) { setError('Erreur recherche'); setResults({}); setTotal(0); return }
        const j = await res.json()
        setResults(j.categories || {})
        setTotal(j.total || 0)
        pushRecent(trimmed)
        setRecent(getRecent())
      } catch (e: any) {
        if (e.name !== 'AbortError') setError(e.message || 'Erreur réseau')
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
  }, [query, activeCats])

  function toggleCat(cat: string) {
    setActiveCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function navigate(r: SearchResult) {
    const isExternal = /^https?:\/\//.test(r.href)
    if (isExternal) {
      window.open(r.href, '_blank', 'noopener,noreferrer')
    } else {
      router.push(r.href)
    }
  }

  function handleRecentClick(q: string) {
    setQuery(q)
  }

  function handleClearRecent() {
    clearRecent()
    setRecent([])
  }

  const hasQuery   = query.trim().length >= MIN_LENGTH
  const noResults  = hasQuery && !loading && total === 0 && !error
  const showWelcome = !hasQuery

  return (
    <AppShell
      title="Recherche"
      userRole={userRole}
      userName={userName}
      userEmail={userEmail || undefined}
      userId={userId || undefined}
      userModules={userModules}
    >
      <style>{`
        @keyframes rs-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes rs-pulse-soft {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.6; }
        }
        @keyframes rs-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(var(--brand-rgb, 99 102 241), 0.35); }
          50%      { box-shadow: 0 0 0 6px rgba(var(--brand-rgb, 99 102 241), 0); }
        }
        .rs-card-enter { animation: rs-fade-up 320ms ease-out both; }
        .rs-stagger-1 { animation-delay: 30ms; }
        .rs-stagger-2 { animation-delay: 70ms; }
        .rs-stagger-3 { animation-delay: 120ms; }
        .rs-stagger-4 { animation-delay: 180ms; }
        .rs-pulse { animation: rs-pulse-soft 1.4s ease-in-out infinite; }
      `}</style>

      <div className="relative min-h-[calc(100vh-4rem)]">
        {/* Subtle ambient gradient background */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60">
          <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-gradient-to-br from-brand/15 to-purple-500/10 blur-3xl" />
          <div className="absolute top-1/3 -right-32 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-info/15 to-success/10 blur-3xl" />
        </div>

        <div className="relative p-4 lg:p-8 max-w-6xl mx-auto space-y-6">

          {/* Hero search */}
          <div className="rs-card-enter">
            <div className="relative">
              {/* Decorative glow */}
              <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-brand/25 via-purple-500/20 to-info/25 blur opacity-70 hidden lg:block" />
              <div className="relative bg-surface border rounded-3xl p-1.5 shadow-xl">
                <div className="flex items-center gap-3 px-4 lg:px-5 py-3 lg:py-4">
                  <div className="relative flex-shrink-0">
                    <Search size={24} className={`text-brand ${loading ? 'opacity-0' : ''}`} />
                    {loading && (
                      <Loader2 size={24} className="absolute inset-0 text-brand animate-spin" />
                    )}
                  </div>
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Plaque, VIN, client, adresse, n° facture, date..."
                    className="flex-1 bg-transparent text-ink text-base lg:text-lg font-medium focus:outline-none placeholder:text-ink-faint placeholder:font-normal"
                  />
                  {query && (
                    <button
                      onClick={() => { setQuery(''); inputRef.current?.focus() }}
                      className="p-1.5 text-ink-muted hover:text-critical hover:rotate-90 transition-all duration-200 flex-shrink-0"
                      title="Effacer"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Layout 2 col desktop, stack mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">

            {/* Sidebar filtres (sticky desktop) */}
            <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
              <div className="bg-surface border rounded-2xl p-4 space-y-3">
                <p className="text-ink-muted text-xs uppercase tracking-wide font-semibold">Catégories</p>
                <div className="space-y-1.5">
                  {CATEGORY_ORDER.map(cat => {
                    const meta   = CATEGORY_META[cat]
                    const count  = results[cat]?.length || 0
                    const active = activeCats.has(cat)
                    return (
                      <button
                        key={cat}
                        onClick={() => toggleCat(cat)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm transition-all border ${
                          active
                            ? `${meta.accent} border-current shadow-sm`
                            : 'border-transparent text-ink-secondary hover:text-ink hover:bg-surface-hover'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{meta.emoji}</span>
                          <span className="text-xs lg:text-sm">{meta.label}</span>
                        </span>
                        {count > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                            active ? 'bg-white/20' : 'bg-ink-faint/10 text-ink-muted'
                          }`}>{count}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {activeCats.size > 0 && (
                  <button
                    onClick={() => setActiveCats(new Set())}
                    className="w-full text-xs text-ink-muted hover:text-critical transition pt-1"
                  >
                    ✕ Tout effacer
                  </button>
                )}
              </div>

              {/* Recherches récentes */}
              {recent.length > 0 && (
                <div className="bg-surface border rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-ink-muted text-xs uppercase tracking-wide font-semibold flex items-center gap-1.5">
                      <Clock size={12} /> Récentes
                    </p>
                    <button
                      onClick={handleClearRecent}
                      className="text-[10px] text-ink-faint hover:text-critical transition"
                    >
                      effacer
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {recent.map(q => (
                      <button
                        key={q}
                        onClick={() => handleRecentClick(q)}
                        className="px-2.5 py-1 rounded-lg text-xs bg-surface-2 hover:bg-brand/10 hover:text-brand text-ink-secondary border transition"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            {/* Résultats */}
            <main className="space-y-4 min-w-0">

              {error && (
                <div className="bg-critical-soft border border-critical rounded-2xl p-4 text-critical text-sm">
                  ⚠ {error}
                </div>
              )}

              {/* Welcome state */}
              {showWelcome && (
                <div className="rs-card-enter bg-surface border rounded-3xl p-8 lg:p-12 text-center space-y-4">
                  <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-brand/25 via-purple-500/20 to-info/20 flex items-center justify-center shadow-xl shadow-brand/10">
                    <Sparkles size={36} className="text-brand rs-pulse" />
                  </div>
                  <div>
                    <h2 className="text-ink text-xl lg:text-2xl font-bold">Recherche globale</h2>
                    <p className="text-ink-muted text-sm mt-1">Tape au moins {MIN_LENGTH} caractères pour explorer toute l'app.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto pt-3 text-left">
                    {[
                      { icon: '🚗', label: 'Plaque tolérante',   ex: '1ABC123 = 1-abc-123' },
                      { icon: '🔧', label: 'VIN partiel',         ex: 'WBA, 123XYZ' },
                      { icon: '📅', label: 'Date',                 ex: '12/05, 2026-05-12' },
                      { icon: '👤', label: 'Client, plaque, n°',  ex: 'Touring INV/2026/...' },
                    ].map((tip, i) => (
                      <div key={tip.label} className={`flex items-start gap-3 p-3 bg-surface-2 border rounded-xl rs-card-enter rs-stagger-${(i % 4) + 1}`}>
                        <span className="text-2xl flex-shrink-0">{tip.icon}</span>
                        <div className="min-w-0">
                          <p className="text-ink text-sm font-medium">{tip.label}</p>
                          <p className="text-ink-muted text-xs mt-0.5 font-mono truncate">{tip.ex}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty results */}
              {noResults && (
                <div className="bg-surface border rounded-3xl p-8 lg:p-12 text-center space-y-3 rs-card-enter">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-brand/20 to-purple-500/20 flex items-center justify-center text-3xl">
                    🔍
                  </div>
                  <p className="text-ink font-semibold text-lg">Aucun résultat</p>
                  <p className="text-ink-muted text-sm">pour <span className="font-mono bg-surface-2 px-2 py-0.5 rounded">{query}</span></p>
                  <p className="text-ink-faint text-xs">Vérifie l'orthographe ou élargis la recherche en retirant des filtres.</p>
                </div>
              )}

              {/* Compteur */}
              {hasQuery && !loading && total > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <p className="text-ink-muted">
                    <span className="text-ink font-semibold">{total}</span> résultat{total > 1 ? 's' : ''} pour
                    <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded ml-1">{query}</span>
                  </p>
                </div>
              )}

              {/* Loading skeleton */}
              {loading && hasQuery && total === 0 && (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-surface border rounded-2xl p-4 animate-pulse">
                      <div className="h-3 bg-surface-2 rounded w-1/4 mb-3" />
                      <div className="h-4 bg-surface-2 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-surface-2 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              )}

              {/* Résultats par catégorie */}
              {CATEGORY_ORDER.map(cat => {
                const items = results[cat]
                if (!items || items.length === 0) return null
                const meta = CATEGORY_META[cat]
                return (
                  <section key={cat} className="rs-card-enter">
                    <div className={`flex items-center gap-2 px-1 mb-2`}>
                      <span className="text-lg">{meta.emoji}</span>
                      <h3 className={`text-sm font-bold uppercase tracking-wide ${meta.text}`}>{meta.label}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.accent} font-medium border`}>{items.length}</span>
                      <div className="flex-1 h-px bg-border ml-2" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {items.map((r, i) => (
                        <button
                          key={`${r.category}-${r.id}`}
                          onClick={() => navigate(r)}
                          className={`group relative bg-surface hover:bg-surface-hover border hover:border-brand/40 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 rounded-2xl p-3.5 text-left overflow-hidden rs-card-enter`}
                          style={{ animationDelay: `${(i % 6) * 30}ms` }}
                        >
                          {/* Gradient overlay subtle */}
                          <div className={`absolute inset-0 bg-gradient-to-br ${meta.gradient} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
                          <div className="relative">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <p className="text-ink text-sm font-semibold leading-snug min-w-0 truncate">{r.title}</p>
                              <ArrowRight size={14} className="text-ink-faint group-hover:text-brand group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-0.5" />
                            </div>
                            {r.subtitle && (
                              <p className="text-ink-secondary text-xs mb-1 truncate">{r.subtitle}</p>
                            )}
                            {r.meta && (
                              <p className="text-ink-faint text-[11px] truncate">{r.meta}</p>
                            )}
                            {r.pdfUrl && (
                              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t">
                                <a
                                  href={r.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-2 hover:bg-surface text-ink-secondary hover:text-ink border rounded-md transition"
                                >
                                  <ExternalLink size={11} /> Odoo
                                </a>
                                <a
                                  href={r.pdfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  download
                                  onClick={e => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-gradient-to-r from-brand to-purple-500 hover:opacity-90 text-white rounded-md transition shadow-sm"
                                >
                                  <FileText size={11} /> PDF
                                </a>
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                )
              })}

            </main>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

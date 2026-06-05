'use client'
// src/app/admin/towsoft-archive/TowsoftArchiveClient.tsx
//
// Olivier 2026-06-05 : page admin pour enrichir l archive complete TowSoft.
// 47000 missions à enrichir via boucle manuelle "Rattraper tout"
// (60 missions / 3 min = ~1,5 jour).

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, RefreshCw, Loader2, BarChart3, Archive, Zap } from 'lucide-react'

interface Stats {
  total:        number
  enriched:     number
  pending:      number
  cancelled:    number
  failed_max:   number
  error_samples: Array<{ towsoft_num: string; enrich_error: string; enrich_attempts: number }>
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

export default function TowsoftArchiveClient({ userRole, userName, userEmail, userModules }: Props) {
  const [stats, setStats]                   = useState<Stats | null>(null)
  const [loadingStats, setLoadingStats]     = useState(true)
  const [initLoading, setInitLoading]       = useState(false)
  const [enrichLoading, setEnrichLoading]   = useState(false)
  const [enrichProgress, setEnrichProgress] = useState<string | null>(null)

  // Cadence loop : 60 fiches / 3 min comme la migration fourriere
  const LOOP_INTERVAL_MS = 3 * 60 * 1000
  const BATCH_SIZE       = 60

  async function loadStats() {
    setLoadingStats(true)
    try {
      const r = await fetch('/api/admin/towsoft-archive/stats')
      const j = await r.json()
      if (r.ok) setStats(j)
    } catch (e) { console.error(e) }
    finally { setLoadingStats(false) }
  }
  useEffect(() => { loadStats() }, [])

  async function doInit() {
    if (!confirm('Initialiser/refresh la liste de missions TowSoft archive (10000 → 57700) ?\n\nIdempotent : ne casse rien si deja fait. Skip les missions du parc actuel.')) return
    setInitLoading(true)
    try {
      const r = await fetch('/api/admin/towsoft-archive/init', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || 'inconnue'}`); return }
      alert(j.message || '✓ Init OK')
      loadStats()
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message || e}`)
    } finally {
      setInitLoading(false)
    }
  }

  async function runEnrichNow(loopUntilDone = false) {
    const msg = loopUntilDone
      ? `Lancer le rattrapage en boucle (jusqu à enrichissement complet) ?\n\n⏱ Intervalle 3 min entre runs · 60 missions par run\n~10 missions/min → ~1,5 jour pour 47000 missions\n\nTu peux fermer cet onglet pour stopper - re-clique pour reprendre.`
      : `Forcer un run d enrichissement (${BATCH_SIZE} missions max) ?`
    if (!confirm(msg)) return
    setEnrichLoading(true)
    setEnrichProgress(loopUntilDone ? 'Démarrage…' : null)

    let totalEnriched = 0
    let totalFailed   = 0
    let runs = 0
    const allErrors: Array<{ towsoft_num: string; error: string }> = []

    try {
      do {
        runs++
        const r = await fetch('/api/admin/towsoft-archive/run-enrich-now', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ batch_size: BATCH_SIZE }),
        })
        const j = await r.json()
        if (!r.ok) {
          alert(`Erreur run ${runs} : ${j.error || 'inconnue'}`)
          return
        }
        totalEnriched += j.enriched || 0
        totalFailed   += j.failed   || 0
        if (j.error_samples) allErrors.push(...j.error_samples)

        if (loopUntilDone) {
          setEnrichProgress(`Run ${runs} : +${j.enriched} enrichies, ${j.remaining} restantes`)
          loadStats()
        }
        if (!loopUntilDone) break
        if ((j.remaining || 0) === 0) break
        if ((j.enriched || 0) === 0 && (j.failed || 0) > 0) {
          alert(`Arrêt : run ${runs} a fait ${j.failed} échec(s) sur ${BATCH_SIZE}.`)
          break
        }

        // Countdown 3 min entre runs
        const tickStart = Date.now()
        while (Date.now() - tickStart < LOOP_INTERVAL_MS) {
          const remainingSec = Math.ceil((LOOP_INTERVAL_MS - (Date.now() - tickStart)) / 1000)
          const mm = Math.floor(remainingSec / 60)
          const ss = remainingSec % 60
          setEnrichProgress(`Run ${runs} OK · prochain run dans ${mm}:${String(ss).padStart(2, '0')} (${j.remaining} restantes)`)
          await new Promise(r => setTimeout(r, 1000))
        }
      } while (loopUntilDone && runs < 1000)  // hard cap 1000 runs (~50h)

      const samples = allErrors.length > 0
        ? `\n\nExemples erreurs :\n${allErrors.slice(0, 5).map(s => `· ${s.towsoft_num} : ${s.error}`).join('\n')}`
        : ''
      alert(`✓ Terminé en ${runs} run(s)\n${totalEnriched} missions enrichies, ${totalFailed} en échec${samples}`)
      loadStats()
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message || e}`)
    } finally {
      setEnrichLoading(false)
      setEnrichProgress(null)
    }
  }

  const progressPct = stats && stats.total > 0 ? Math.round((stats.enriched / stats.total) * 100) : 0

  return (
    <AppShell title="Archive TowSoft" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">

        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/admin"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-xs font-medium transition">
            <ArrowLeft size={13} /> Admin
          </Link>
          <h1 className="font-display text-xl font-bold text-ink flex-1 flex items-center gap-2">
            <Archive size={20} className="text-brand" />
            Archive TowSoft (recherche enrichie)
          </h1>
          <button onClick={loadStats} disabled={loadingStats}
            className="p-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink transition disabled:opacity-50">
            <RefreshCw size={14} className={loadingStats ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="bg-info-50 border border-info-200 rounded-2xl p-4 text-sm text-info-800">
          <p className="font-semibold mb-1">📖 À quoi ça sert ?</p>
          <p>Enrichit en BDD les ~47000 missions TowSoft historiques (range 10000 → 57700) pour que la recherche
          dans VD Soft (/recherche) puisse les retrouver instantanément avec tous les détails (plaque, VIN, client,
          motif, lieu, dates, etc.) au lieu de devoir aller dans TowSoft.</p>
          <p className="mt-2">Skip les missions déjà dans le parc actuel (towsoft_migration_source).</p>
        </div>

        {/* Stats */}
        {stats ? (
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold text-sm text-ink flex items-center gap-2"><BarChart3 size={14} /> Progression</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total" value={stats.total} color="ink" />
              <StatCard label="Enrichies" value={stats.enriched} color="success" suffix={`/${stats.total}`} />
              <StatCard label="En attente" value={stats.pending} color="warning" />
              <StatCard label="Annulées" value={stats.cancelled} color="ink" />
            </div>

            {/* Progress bar */}
            <div className="w-full bg-surface-2 rounded-full h-2 overflow-hidden">
              <div className="bg-success h-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-xs text-ink-muted text-center">{progressPct}% enrichi</p>

            {stats.failed_max > 0 && (
              <div className="bg-critical/10 border border-critical/30 rounded-lg p-2 text-xs text-critical">
                ⚠ {stats.failed_max} missions ont atteint le nombre max d essais (5). Voir error_samples dans /api/admin/towsoft-archive/stats.
              </div>
            )}

            {/* Boutons */}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {stats.total === 0 && (
                <button onClick={doInit} disabled={initLoading}
                  className="px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                  {initLoading ? '⏳ Init...' : '🚀 Initialiser la liste (10000 → 57700)'}
                </button>
              )}
              {stats.total > 0 && (
                <>
                  <button onClick={() => runEnrichNow(true)} disabled={enrichLoading || stats.pending === 0}
                    className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition disabled:opacity-50 flex items-center gap-1.5">
                    <Zap size={14} />
                    {enrichLoading ? (enrichProgress || '⏳ Boucle...') : `⚡⚡ Rattraper tout (${stats.pending} restantes)`}
                  </button>
                  <button onClick={() => runEnrichNow(false)} disabled={enrichLoading || stats.pending === 0}
                    className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1">
                    <Zap size={11} />
                    {enrichLoading ? '⏳' : `Tester +${BATCH_SIZE}`}
                  </button>
                  <button onClick={doInit} disabled={initLoading}
                    className="text-xs text-ink-muted hover:text-ink underline ml-auto self-center">
                    {initLoading ? '⏳' : '↻ Refresh la liste (au cas où nouveaux numéros)'}
                  </button>
                </>
              )}
            </div>

            {/* Échantillons d'erreurs */}
            {stats.error_samples && stats.error_samples.length > 0 && (
              <details className="text-xs">
                <summary className="text-ink-muted cursor-pointer hover:text-ink">Exemples d'erreurs récentes ({stats.error_samples.length})</summary>
                <ul className="mt-2 space-y-1">
                  {stats.error_samples.map((s, i) => (
                    <li key={i} className="bg-surface-2 rounded p-2">
                      <span className="font-mono font-bold">{s.towsoft_num}</span>
                      <span className="text-ink-muted"> (tentative {s.enrich_attempts}) :</span>
                      <span className="block text-critical mt-1">{s.enrich_error}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <div className="bg-surface border rounded-2xl p-6 text-center text-ink-muted">
            <Loader2 className="inline animate-spin mr-2" size={14} /> Chargement…
          </div>
        )}

      </div>
    </AppShell>
  )
}

function StatCard({ label, value, color, suffix }: { label: string; value: number; color: string; suffix?: string }) {
  const colorClass = color === 'success' ? 'text-success' : color === 'warning' ? 'text-warning-700' : color === 'info' ? 'text-info' : color === 'critical' ? 'text-critical' : 'text-ink'
  return (
    <div className="bg-surface-2 border rounded-xl p-3">
      <p className={`text-xl font-bold ${colorClass}`}>{value.toLocaleString('fr-BE')}{suffix && <span className="text-xs text-ink-muted font-normal">{suffix}</span>}</p>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mt-1">{label}</p>
    </div>
  )
}

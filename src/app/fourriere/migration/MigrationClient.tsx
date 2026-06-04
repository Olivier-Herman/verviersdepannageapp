'use client'
// src/app/fourriere/migration/MigrationClient.tsx
//
// Olivier 2026-06-04 : module Reconstruction Fourriere TowSoft -> VD Soft.
//
// Workflow :
//   1. Tableau de bord progression (scanned/total, par zone, enriched detail)
//   2. Declare la zone physique (A, B*, B, C, D, E, F, G, H, I, J, K, L, Box, S, Transit)
//   3. Scan en rafale : input plaque/QR -> POST /scan
//   4. Liste des scans accumules (peut retirer en erreur)
//   5. Popup confirmation si deja scanne ailleurs
//   6. Clic 'Terminer la zone' -> declenche le worker (cron) + bouton batch impression

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, RefreshCw, Loader2, ScanLine, Check, X, AlertTriangle, Building2, Printer, BarChart3 } from 'lucide-react'
import { normalizePlate } from '@/lib/plate'

interface Stats {
  total: number
  scanned: number
  imported: number
  enriched: number
  pending_import: number
  by_zone: Record<string, number>
}

interface ScanItem {
  id: string                       // local
  raw: string
  zone: string
  status: 'ok' | 'rescanned' | 'already_in_zone' | 'fantome' | 'duplicate_conflict' | 'pending'
  plate?: string | null
  towsoft_num?: string | null
  motif?: string | null
  message: string
  at: string
}

const ZONES = ['A', 'B*', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LABO', 'S', 'Box', 'Transit']

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

export default function MigrationClient({ userRole, userName, userEmail, userModules }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)
  const [initLoading, setInitLoading] = useState(false)
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [zone, setZone] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [scans, setScans] = useState<ScanItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [confirmConflict, setConfirmConflict] = useState<{ raw: string; match: any } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function loadStats() {
    setLoadingStats(true)
    try {
      const r = await fetch('/api/admin/towsoft-migration/stats')
      const j = await r.json()
      if (r.ok) setStats(j)
    } catch (e) { console.error(e) }
    finally { setLoadingStats(false) }
  }

  useEffect(() => { loadStats() }, [])

  // Refocus input apres chaque scan
  useEffect(() => {
    if (zone && inputRef.current) inputRef.current.focus()
  }, [zone, scans.length])

  async function runEnrichNow() {
    if (!confirm('Forcer un run d enrichissement TowSoft maintenant (15 fiches max) ?\n\nUtile si le cron ne progresse pas.')) return
    setEnrichLoading(true)
    try {
      const r = await fetch('/api/admin/towsoft-migration/run-enrich-now', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || 'inconnue'}`); return }
      const samples = j.error_samples && j.error_samples.length > 0
        ? `\n\nExemples erreurs :\n${j.error_samples.map((s: any) => `· ${s.towsoft_num} : ${s.error}`).join('\n')}`
        : ''
      alert(`✓ ${j.enriched} fiches enrichies, ${j.failed} en echec\n${j.remaining} restantes${samples}`)
      loadStats()
    } catch (e: any) {
      alert(`Erreur reseau : ${e?.message || e}`)
    } finally {
      setEnrichLoading(false)
    }
  }

  async function initImport() {
    if (!confirm('Initialiser/refresh la liste des 733 fiches TowSoft ? (Idempotent : ne casse rien si deja fait)')) return
    setInitLoading(true)
    try {
      const r = await fetch('/api/admin/towsoft-migration/init', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || 'inconnue'}`); return }
      alert(`✓ ${j.upserted} fiches sur ${j.total_towsoft} importees dans la table source.`)
      loadStats()
    } catch (e: any) {
      alert(`Erreur reseau : ${e?.message || e}`)
    } finally {
      setInitLoading(false)
    }
  }

  async function handleScan(rawValue?: string, forceRescan = false) {
    const raw = (rawValue ?? input).trim()
    if (!raw || !zone || scanning) return

    setScanning(true)
    setInput('')

    try {
      const r = await fetch('/api/admin/towsoft-migration/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ raw_input: raw, zone, force_rescan: forceRescan }),
      })
      const j = await r.json()

      // Cas conflit zone : popup confirmation
      if (r.status === 409 && j.reason === 'already_scanned') {
        setConfirmConflict({ raw, match: j.match })
        setScanning(false)
        return
      }

      const item: ScanItem = {
        id: `${Date.now()}-${Math.random()}`,
        raw, zone,
        status: !r.ok
          ? (j.reason === 'not_in_towsoft' ? 'fantome' : 'duplicate_conflict')
          : (j.reason === 'already_in_zone' ? 'already_in_zone'
            : j.reason === 'rescanned_zone_changed' ? 'rescanned'
            : 'ok'),
        plate:       j.match?.plate,
        towsoft_num: j.match?.towsoft_num,
        motif:       j.match?.motif,
        message:     j.message || (r.ok ? 'OK' : 'Erreur'),
        at:          new Date().toISOString(),
      }
      setScans(prev => [item, ...prev])
      if (r.ok) loadStats()
    } catch (e: any) {
      setScans(prev => [{
        id: `${Date.now()}-${Math.random()}`,
        raw, zone: zone!,
        status: 'fantome',
        message: `Erreur reseau : ${e?.message || e}`,
        at: new Date().toISOString(),
      }, ...prev])
    } finally {
      setScanning(false)
    }
  }

  function confirmRescan() {
    if (!confirmConflict) return
    const { raw } = confirmConflict
    setConfirmConflict(null)
    handleScan(raw, true)
  }

  function cancelRescan() {
    setConfirmConflict(null)
  }

  function removeScan(id: string) {
    setScans(prev => prev.filter(s => s.id !== id))
  }

  function endZone() {
    if (!confirm(`Terminer la zone ${zone} ? (${scans.length} scans enregistres - le worker creera les missions VD Soft en arriere-plan)`)) return
    setScans([])
    setZone(null)
    alert('✓ Zone terminee. Tu peux declarer la suivante. Les missions seront creees dans les prochaines minutes par le worker (cron).')
    loadStats()
  }

  return (
    <AppShell title="Reconstruction Fourriere" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/fourriere"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-xs font-medium transition">
            <ArrowLeft size={13} /> Fourriere
          </Link>
          <h1 className="font-display text-xl font-bold text-ink flex-1">Reconstruction Fourriere (TowSoft → VD Soft)</h1>
          <button onClick={loadStats} disabled={loadingStats}
            className="p-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink transition disabled:opacity-50">
            <RefreshCw size={14} className={loadingStats ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Tableau de bord */}
        {stats ? (
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold text-sm text-ink flex items-center gap-2"><BarChart3 size={14} /> Progression</h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total TowSoft" value={stats.total} color="ink" />
              <StatCard label="Scannes" value={stats.scanned} color="info" suffix={`/${stats.total}`} />
              <StatCard label="Importes VD Soft" value={stats.imported} color="success" suffix={`/${stats.scanned || 1}`} />
              <StatCard label="Detail enrichi" value={stats.enriched} color="warning" suffix={`/${stats.total}`} />
            </div>

            {stats.scanned > 0 && Object.keys(stats.by_zone).length > 0 && (
              <div>
                <p className="text-xs text-ink-muted uppercase tracking-wide font-semibold mb-2">Par zone scannee :</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.by_zone).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([z, n]) => (
                    <span key={z} className="px-2 py-1 bg-surface-2 border rounded-full text-xs">
                      <span className="font-mono font-bold">{z}</span>
                      <span className="ml-1 text-ink-muted">· {n}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {stats.total === 0 && (
              <button onClick={initImport} disabled={initLoading}
                className="w-full py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {initLoading ? '⏳ Initialisation...' : '🔄 Initialiser la liste TowSoft (733 fiches)'}
              </button>
            )}
            {stats.total > 0 && (
              <div className="flex items-center gap-3 flex-wrap text-xs pt-1">
                <button onClick={initImport} disabled={initLoading}
                  className="text-ink-muted hover:text-ink underline">
                  {initLoading ? '⏳' : '↻ Refresh la liste TowSoft'}
                </button>
                {stats.enriched < stats.total && (
                  <button onClick={runEnrichNow} disabled={enrichLoading}
                    className="px-2 py-1 bg-warning-50 hover:bg-warning-100 text-warning-800 border border-warning-200 rounded font-semibold disabled:opacity-50">
                    {enrichLoading ? '⏳ Enrichissement...' : `⚡ Forcer enrichissement (${stats.total - stats.enriched} restantes)`}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-surface border rounded-2xl p-6 text-center text-ink-muted">
            <Loader2 className="inline animate-spin mr-2" size={14} /> Chargement…
          </div>
        )}

        {/* Selection zone */}
        <div className="bg-surface border rounded-2xl p-4 space-y-3">
          <h2 className="font-semibold text-sm text-ink flex items-center gap-2"><Building2 size={14} /> Zone physique a scanner</h2>
          {zone ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1.5 bg-brand text-white rounded-lg text-sm font-bold">Zone {zone}</span>
              <span className="text-ink-muted text-xs">— {scans.length} scan{scans.length > 1 ? 's' : ''} en cours</span>
              <button onClick={() => { if (confirm(`Changer de zone ? (${scans.length} scans seront perdus si tu ne termines pas la zone d'abord)`)) { setZone(null); setScans([]) } }}
                className="ml-auto px-2 py-1 text-ink-muted hover:text-ink text-xs">
                Changer zone
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {ZONES.map(z => (
                <button key={z} onClick={() => setZone(z)}
                  className="px-3 py-2 bg-surface-2 hover:bg-brand hover:text-white border rounded-lg text-sm font-bold text-ink transition">
                  {z}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input scan + liste */}
        {zone && (
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ScanLine size={16} className="text-brand" />
              <h2 className="font-semibold text-sm text-ink">Scanne ou tape ici (Enter pour valider)</h2>
            </div>
            <form onSubmit={e => { e.preventDefault(); handleScan() }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.toUpperCase())}
                placeholder="Scanne QR / tape plaque / VIN / n° TowSoft..."
                disabled={scanning}
                autoFocus
                className="w-full bg-surface-2 border rounded-xl px-4 py-3 text-ink text-base font-mono focus:outline-none focus:border-brand placeholder:text-ink-faint disabled:opacity-50"
              />
            </form>
            {scanning && (
              <div className="text-xs text-ink-muted flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Traitement…
              </div>
            )}

            {scans.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-ink-muted uppercase font-semibold">
                    {scans.length} scan{scans.length > 1 ? 's' : ''} - zone {zone}
                  </p>
                  <button onClick={endZone}
                    className="px-3 py-1.5 bg-success hover:bg-success/90 text-white rounded-lg text-xs font-semibold transition">
                    ✓ Terminer la zone {zone}
                  </button>
                </div>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {scans.map(s => <ScanRow key={s.id} item={s} onRemove={() => removeScan(s.id)} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Popup confirmation conflit */}
        {confirmConflict && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={cancelRescan}>
            <div className="bg-surface border rounded-2xl p-5 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={20} className="text-warning" />
                <h3 className="font-bold text-ink">Vehicule deja scanne ailleurs</h3>
              </div>
              <div className="bg-surface-2 border rounded-lg p-3 mb-3 text-sm">
                <p><strong className="text-ink">{confirmConflict.match?.plate || confirmConflict.match?.towsoft_num}</strong></p>
                <p className="text-ink-muted text-xs mt-1">
                  Deja scanne en zone <strong>{confirmConflict.match?.scanned_zone}</strong>
                  {confirmConflict.match?.scanned_at && ` le ${new Date(confirmConflict.match.scanned_at).toLocaleString('fr-BE')}`}
                </p>
              </div>
              <p className="text-ink text-sm mb-4">
                Confirmer le changement vers <strong className="text-brand">zone {zone}</strong> ?
                <br/>
                <span className="text-ink-muted text-xs">(L ancien placement sera ecrase, le worker re-creera la mission au bon endroit)</span>
              </p>
              <div className="flex gap-2">
                <button onClick={cancelRescan}
                  className="flex-1 py-2 bg-surface-2 border text-ink-secondary rounded-lg text-sm">
                  Annuler
                </button>
                <button onClick={confirmRescan}
                  className="flex-1 py-2 bg-warning text-white rounded-lg text-sm font-semibold">
                  Confirmer changement
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function StatCard({ label, value, color, suffix }: { label: string; value: number; color: string; suffix?: string }) {
  const colorMap: Record<string, string> = {
    ink:     'text-ink',
    info:    'text-info',
    success: 'text-success',
    warning: 'text-warning',
  }
  return (
    <div className="bg-surface-2 border rounded-xl p-3">
      <p className={`font-bold text-2xl ${colorMap[color] || 'text-ink'}`}>
        {value}{suffix && <span className="text-sm font-normal text-ink-muted">{suffix}</span>}
      </p>
      <p className="text-ink-muted text-xs mt-0.5">{label}</p>
    </div>
  )
}

function ScanRow({ item, onRemove }: { item: ScanItem; onRemove: () => void }) {
  const map: Record<string, { icon: any; cls: string; label: string }> = {
    ok:                 { icon: Check,          cls: 'text-success border-success/30 bg-success/10', label: 'OK' },
    rescanned:          { icon: AlertTriangle,  cls: 'text-warning border-warning/30 bg-warning/10', label: 'Re-place' },
    already_in_zone:    { icon: Check,          cls: 'text-ink-muted border bg-surface-2',          label: 'Deja ici' },
    fantome:            { icon: X,              cls: 'text-critical border-critical/30 bg-critical/10', label: 'Fantome' },
    duplicate_conflict: { icon: AlertTriangle,  cls: 'text-warning border-warning/30 bg-warning/10', label: 'Conflit' },
    pending:            { icon: Loader2,        cls: 'text-ink-muted border',                        label: '...' },
  }
  const v = map[item.status] || map.pending
  const Icon = v.icon
  return (
    <div className={`flex items-center gap-2 p-2 border rounded-lg text-xs ${v.cls}`}>
      <Icon size={14} className={item.status === 'pending' ? 'animate-spin' : ''} />
      <div className="flex-1 min-w-0">
        <p className="font-mono font-bold truncate">{item.plate || item.towsoft_num || item.raw}</p>
        <p className="text-ink-muted truncate">
          {item.motif ? `${item.motif} · ` : ''}{item.message}
        </p>
      </div>
      <button onClick={onRemove} className="text-ink-muted hover:text-ink p-1">
        <X size={12} />
      </button>
    </div>
  )
}

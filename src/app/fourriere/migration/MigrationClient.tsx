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
import dynamic from 'next/dynamic'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import { ArrowLeft, RefreshCw, Loader2, ScanLine, Check, X, AlertTriangle, Building2, Printer, BarChart3, Ghost, Archive, Camera } from 'lucide-react'
import { normalizePlate } from '@/lib/plate'

// QRScanner = camera + auto-detection rafale (dedup 3.5s, bip), Capacitor compatible
const QRScanner = dynamic(() => import('@/components/fourriere/QRScanner'), { ssr: false })

interface Stats {
  total: number
  scanned: number
  imported: number
  enriched: number
  orphans: number
  pending_import: number
  by_zone: Record<string, number>
  orphans_by_zone: Record<string, number>
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
  // Olivier 2026-06-06 : retours du scan inline (mission VD Soft + Odoo + label)
  vdsoft_mission_id?:    string | null
  odoo_state_transferred?: boolean
  label_printed?:        boolean
  label_error?:          string | null
}

// Olivier 2026-06-04 : zones fetchées dynamiquement depuis parc_zones BDD
// (au lieu de const figée) pour que les nouvelles zones créées via /admin/parc
// apparaissent ici sans modif de code.
const FALLBACK_ZONES = ['A', 'B*', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LABO', 'S', 'Box', 'Transit']

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
  const [zones, setAvailableZones] = useState<string[]>(FALLBACK_ZONES)
  const [input, setInput] = useState('')
  const [scans, setScans] = useState<ScanItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [confirmConflict, setConfirmConflict] = useState<{ raw: string; match: any } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  // Olivier 2026-06-06 : impression auto etiquette parc apres chaque scan reussi
  const [printOnScan, setPrintOnScan] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  // Charge les zones actives depuis BDD (fallback si erreur reseau)
  useEffect(() => {
    fetch('/api/fourriere/zones-by-depot')
      .then(r => r.json())
      .then(j => {
        const allZones: string[] = []
        for (const d of (j.depots || [])) for (const z of (d.zones || [])) allZones.push(z.key)
        for (const z of (j.orphans || [])) allZones.push(z.key)
        if (allZones.length > 0) setAvailableZones(allZones)
      })
      .catch(() => {/* fallback en place */})
  }, [])

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

  const [enrichProgress, setEnrichProgress] = useState<string | null>(null)
  const LOOP_INTERVAL_MS = 3 * 60 * 1000  // 3 min entre runs (~125 req/min TowSoft = humain actif, discret)

  async function runEnrichNow(loopUntilDone = false) {
    const msg = loopUntilDone
      ? `Lancer le rattrapage en boucle (jusqu a ce que toutes les fiches soient enrichies) ?\n\n⏱ Intervalle 3 min entre runs · 30 fiches par run\n~10 fiches/min -> ~1h pour 553 fiches\n\nTu peux fermer cet onglet pour stopper - re-clique pour reprendre.`
      : 'Forcer un run d enrichissement TowSoft maintenant (30 fiches max) ?\n\nUtile si le cron ne progresse pas.'
    if (!confirm(msg)) return
    setEnrichLoading(true)
    setEnrichProgress(loopUntilDone ? 'Demarrage…' : null)

    let totalEnriched = 0
    let totalFailed   = 0
    let runs = 0
    const allErrors: Array<{ towsoft_num: string; error: string }> = []

    try {
      do {
        runs++
        const r = await fetch('/api/admin/towsoft-migration/run-enrich-now', { method: 'POST' })
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
          alert(`Arret : run ${runs} a fait ${j.failed} echec(s) sur 15.\nVoir error_samples ci-dessous.`)
          break
        }

        // Pause 5 min entre runs (= cadence cron, discret cote TowSoft)
        // Affiche un countdown pour Olivier
        const tickStart = Date.now()
        while (Date.now() - tickStart < LOOP_INTERVAL_MS) {
          const remainingSec = Math.ceil((LOOP_INTERVAL_MS - (Date.now() - tickStart)) / 1000)
          const mm = Math.floor(remainingSec / 60)
          const ss = remainingSec % 60
          setEnrichProgress(`Run ${runs} OK · prochain run dans ${mm}:${String(ss).padStart(2, '0')} (${j.remaining} restantes)`)
          await new Promise(r => setTimeout(r, 1000))
        }
      } while (loopUntilDone && runs < 60)  // hard cap 60 runs (~5h)

      const samples = allErrors.length > 0
        ? `\n\nExemples erreurs :\n${allErrors.slice(0, 5).map(s => `· ${s.towsoft_num} : ${s.error}`).join('\n')}`
        : ''
      alert(`✓ Termine en ${runs} run(s)\n${totalEnriched} fiches enrichies, ${totalFailed} en echec${samples}`)
      loadStats()
    } catch (e: any) {
      alert(`Erreur reseau : ${e?.message || e}`)
    } finally {
      setEnrichLoading(false)
      setEnrichProgress(null)
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
        body:    JSON.stringify({ raw_input: raw, zone, force_rescan: forceRescan, print_label: printOnScan }),
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
        vdsoft_mission_id:      j.vdsoft_mission_id || null,
        odoo_state_transferred: !!j.odoo_state_transferred,
        label_printed:          !!j.label_printed,
        label_error:            j.label_error || null,
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

  async function clearZone() {
    if (!zone) return
    // 1) Dry-run : combien de vehicules concernes ?
    try {
      const preview = await fetch('/api/admin/parc/clear-zone', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zone, dry_run: true, preserve_recent_scans: false }),
      })
      const previewJ = await preview.json()
      if (!preview.ok) { alert(`Erreur preview : ${previewJ.error || preview.status}`); return }
      const n = previewJ.count || 0
      const preserved = previewJ.preserved || 0
      if (n === 0 && preserved === 0) {
        alert(`Aucun véhicule en BDD en zone ${zone}. Tu peux scanner directement.`)
        return
      }
      if (n === 0) {
        alert(`Rien à vider — les ${preserved} véhicules en zone ${zone} sont tous issus de tes scans récents. Continue ton scan !`)
        return
      }
      if (!confirm(`🧹 Vider la zone ${zone} (smart) ?\n\n${preserved > 0 ? `✓ ${preserved} véhicule${preserved > 1 ? 's' : ''} scanné${preserved > 1 ? 's' : ''} récemment (préservé${preserved > 1 ? 's' : ''})\n` : ''}🗑 ${n} véhicule${n > 1 ? 's' : ''} hérité${n > 1 ? 's' : ''} d Odoo (NON scanné${n > 1 ? 's' : ''}) → vidé${n > 1 ? 's' : ''}\n\nResultat : la zone ${zone} contiendra uniquement les ${preserved + 0} véhicules réellement scannés par toi.\n\nLes ${n} vidés restent en BDD mais sans zone → consultables via /recherche.`)) return

      // 2) Vide reellement (mode brutal : on vire TOUT, Olivier re-scannera)
      const r = await fetch('/api/admin/parc/clear-zone', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zone, preserve_recent_scans: false }),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || r.status}`); return }
      alert(`✓ Zone ${zone} nettoyée — ${j.count || 0} véhicule(s) hérité(s) Odoo virés${j.preserved ? `, ${j.preserved} scans préservés` : ''}.`)
      loadStats()
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message || e}`)
    }
  }

  function endZone() {
    if (!confirm(`Terminer la zone ${zone} ? (${scans.length} scans enregistres - le worker creera les missions VD Soft en arriere-plan)`)) return
    const doneZone = zone
    setScans([])
    setZone(null)
    alert(`✓ Zone ${doneZone} terminee. Tu peux declarer la suivante. Les missions seront creees dans les prochaines minutes par le worker (cron).\n\nUtilise le bouton "Imprimer etiquettes zone ${doneZone}" quand le worker aura fini (refresh stats pour voir le compteur monter).`)
    loadStats()
  }

  // Olivier 2026-06-04 : reimpression totale par defaut. On veut imprimer
  // TOUTES les etiquettes de la zone a chaque clic, pas seulement les non
  // imprimees (l operateur peut etre amene a re-imprimer apres bourrage ou
  // remplacement d etiquettes).
  async function printZone(targetZone: string) {
    if (!confirm(`Réimpression TOTALE des étiquettes de la zone ${targetZone} ?\n\nToutes les étiquettes seront imprimées (même celles déjà imprimées). L'impression est séquentielle, le PC Zebra fait la queue.`)) return
    try {
      const r = await fetch('/api/admin/towsoft-migration/print-zone', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone: targetZone, only_unprinted: false }),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error || 'inconnue'}`); return }
      const errs = j.errors && j.errors.length > 0
        ? `\n\nErreurs :\n${j.errors.map((e: any) => `· ${e.mission_id.slice(0, 8)} : ${e.error}`).join('\n')}`
        : ''
      alert(`✓ ${j.printed}/${j.total} etiquettes imprimees${errs}`)
    } catch (e: any) {
      alert(`Erreur reseau : ${e?.message || e}`)
    }
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
          <Link href="/fourriere/migration/orphans"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-warning-50 hover:bg-warning-100 border border-warning-200 rounded-lg text-warning-800 text-xs font-semibold transition">
            <Ghost size={13} /> Fantomes
          </Link>
          <Link href="/fourriere/migration/archive"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-xs font-semibold transition">
            <Archive size={13} /> Archive
          </Link>
          <button onClick={loadStats} disabled={loadingStats}
            className="p-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink transition disabled:opacity-50">
            <RefreshCw size={14} className={loadingStats ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Tableau de bord */}
        {stats ? (
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold text-sm text-ink flex items-center gap-2"><BarChart3 size={14} /> Progression</h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard label="Total TowSoft" value={stats.total} color="ink" />
              <StatCard label="Scannes" value={stats.scanned} color="info" suffix={`/${stats.total}`} />
              <StatCard label="Importes VD Soft" value={stats.imported} color="success" suffix={`/${stats.scanned || 1}`} />
              <Link href="/fourriere/migration/orphans" className="block">
                <StatCard label="Fantomes (pas TS)" value={stats.orphans} color="warning" />
              </Link>
              <StatCard label="Detail enrichi" value={stats.enriched} color="warning" suffix={`/${stats.total}`} />
            </div>
            {stats.orphans > 0 && (
              <p className="text-xs text-warning-700 -mt-1">
                ⚠ Tu as scanné {stats.scanned + stats.orphans} véhicules au total ({stats.scanned} matchs TowSoft + {stats.orphans} fantômes à investiguer dans <Link href="/fourriere/migration/orphans" className="underline font-semibold">Fantômes</Link>)
              </p>
            )}

            {(stats.scanned > 0 || stats.orphans > 0) && (Object.keys(stats.by_zone).length > 0 || Object.keys(stats.orphans_by_zone || {}).length > 0) && (
              <div>
                <p className="text-xs text-ink-muted uppercase tracking-wide font-semibold mb-2">Par zone scannee (clic = imprimer etiquettes) :</p>
                <div className="flex flex-wrap gap-2">
                  {Array.from(new Set([...Object.keys(stats.by_zone), ...Object.keys(stats.orphans_by_zone || {})]))
                    .map(z => ({ z, n: stats.by_zone[z] || 0, orphans: (stats.orphans_by_zone || {})[z] || 0 }))
                    .sort((a, b) => (b.n + b.orphans) - (a.n + a.orphans))
                    .map(({ z, n, orphans }) => (
                      <button key={z} onClick={() => printZone(z)} title={`Imprimer etiquettes zone ${z}`}
                        className="px-2 py-1 bg-surface-2 hover:bg-info-50 hover:border-info-300 border rounded-full text-xs transition flex items-center gap-1">
                        <Printer size={11} className="text-info-700" />
                        <span className="font-mono font-bold">{z}</span>
                        <span className="text-ink-muted">· {n}</span>
                        {orphans > 0 && <span className="text-warning-700 font-semibold">+{orphans}👻</span>}
                      </button>
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
                  <>
                    <button onClick={() => runEnrichNow(false)} disabled={enrichLoading}
                      className="px-2 py-1 bg-warning-50 hover:bg-warning-100 text-warning-800 border border-warning-200 rounded font-semibold disabled:opacity-50">
                      {enrichLoading ? '⏳' : `⚡ +30`}
                    </button>
                    <button onClick={() => runEnrichNow(true)} disabled={enrichLoading}
                      className="px-2 py-1 bg-info-50 hover:bg-info-100 text-info-800 border border-info-200 rounded font-semibold disabled:opacity-50">
                      {enrichLoading ? (enrichProgress || '⏳ Boucle...') : `⚡⚡ Rattraper tout (${stats.total - stats.enriched})`}
                    </button>
                  </>
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
              <div className="ml-auto flex items-center gap-2">
                <button onClick={clearZone}
                  className="px-2 py-1 bg-warning-50 hover:bg-warning-100 text-warning-800 border border-warning-200 rounded text-xs font-semibold transition"
                  title="Reset les véhicules en BDD assignés à cette zone (héritage Odoo). Tu repars de zéro pour la zone.">
                  🧹 Vider la zone
                </button>
                <button onClick={() => { if (confirm(`Changer de zone ? (${scans.length} scans seront perdus si tu ne termines pas la zone d'abord)`)) { setZone(null); setScans([]) } }}
                  className="px-2 py-1 text-ink-muted hover:text-ink text-xs">
                  Changer zone
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {zones.map(z => (
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <ScanLine size={16} className="text-brand" />
                <h2 className="font-semibold text-sm text-ink">Scanne ou tape ici (Enter pour valider)</h2>
              </div>
              <button
                onClick={() => setCameraOpen(true)}
                disabled={scanning}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
              >
                <Camera size={14} /> Scanner caméra
              </button>
            </div>
            {/* Toggle impression auto etiquette */}
            <label className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={printOnScan}
                onChange={e => setPrintOnScan(e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              <span>🏷️ Imprimer l'étiquette parc juste après chaque scan</span>
            </label>
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

      {/* Scanner camera plein ecran. Rafale : QRScanner reste actif, paused
          pendant traitement async (scanning=true) puis reprend. Olivier 2026-06-04. */}
      {cameraOpen && zone && (
        <QRScanner
          paused={scanning || !!confirmConflict}
          onScan={(qrText) => handleScan(qrText)}
          onClose={() => setCameraOpen(false)}
        />
      )}
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

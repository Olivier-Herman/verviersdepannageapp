'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

interface Item {
  id: string
  received_at: string | null
  remise_date: string
  brand: string | null
  model: string | null
  vehicle: string
  vin: string
  pv_remise_name: string | null
  matched_mission_id: string | null
  outcome: string
  applied_date: string | null
  mission_number: number | null
  zone: string | null
  mission_status: string | null
  plate: string | null
  firm: string | null
  vente_date: string | null
  date_out: string | null
}

const fmt = (d: string | null) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return d }
}

const OUTCOME: Record<string, { label: string; cls: string }> = {
  applied:     { label: '✅ Date posée',   cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  already_set: { label: 'ℹ️ Déjà datée',  cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  no_match:    { label: '⚠ Non trouvé',   cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  ambiguous:   { label: '⚠ Ambigu',       cls: 'bg-red-500/15 text-red-700 dark:text-red-300' },
}

export default function DatesInClient(props: { userRole: string; userName: string; userEmail?: string; userModules: string[] }) {
  const [items, setItems]   = useState<Item[]>([])
  const [counts, setCounts] = useState<any>(null)
  const [lastRun, setLastRun] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [msg, setMsg]       = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      // no-store : toujours des données fraîches (zone/statut/vente à jour).
      const r = await fetch('/api/fourriere/domaine-dates-in', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) { setItems(j.items || []); setCounts(j.counts || null); setLastRun(j.lastRun || null) }
      else setMsg(j.error || 'Erreur')
    } finally { setLoading(false) }
  }
  // Recharge au montage ET quand l'onglet redevient visible (retour sur la page).
  useEffect(() => {
    load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [])

  async function sync() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/fourriere/domaine-dates-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) })
      const j = await r.json()
      if (r.ok) { setMsg(`✅ ${j.applied} date(s) posée(s) · ${j.noMatch} non trouvé(s) · ${j.ambiguous} ambigu(s)`); await load() }
      else setMsg(`⚠ ${j.error || 'Échec'}`)
    } catch { setMsg('⚠ Erreur réseau') } finally { setBusy(false) }
  }

  return (
    <AppShell title="Domaine — Dates IN" userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userModules={props.userModules}>
      <div className="p-4 lg:p-6 space-y-4 max-w-6xl mx-auto">
        <Link href="/fourriere/domaine" className="text-ink-muted text-sm">← Domaine (gardiennage)</Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-ink text-2xl font-bold">🏛 Domaine — Dates IN</h1>
            <p className="text-ink-muted text-sm">Remises officielles au Domaine (SPF Finances). La date de remise est posée automatiquement sur la saisie correspondante (match 5 derniers du VIN).</p>
          </div>
          <button onClick={sync} disabled={busy}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
            {busy ? '⏳ Synchro…' : '🔄 Synchroniser les mails'}
          </button>
        </div>

        {counts && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="px-2 py-1 rounded bg-surface-2 border">{counts.total} ligne(s)</span>
            <span className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">{counts.applied} datée(s)</span>
            <span className="px-2 py-1 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">{counts.alreadySet} déjà datée(s)</span>
            <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">{counts.noMatch} non trouvé(s)</span>
            <span className="px-2 py-1 rounded bg-red-500/15 text-red-700 dark:text-red-300">{counts.ambiguous} ambigu(s)</span>
            {lastRun?.at && <span className="text-ink-faint ml-auto">Dernière synchro : {new Date(lastRun.at).toLocaleString('fr-BE')}</span>}
          </div>
        )}

        {msg && <div className="bg-surface-2 border rounded-xl px-4 py-2.5 text-sm text-ink-secondary">{msg}</div>}

        {loading ? (
          <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">Chargement…</div>
        ) : items.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">Aucune ligne « Dates IN » capturée pour le moment.</div>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2.5">Date remise</th>
                  <th className="text-left px-3 py-2.5">Véhicule</th>
                  <th className="text-left px-3 py-2.5">Châssis</th>
                  <th className="text-left px-3 py-2.5">PV de remise</th>
                  <th className="text-left px-3 py-2.5">Fiche</th>
                  <th className="text-left px-3 py-2.5">Zone</th>
                  <th className="text-left px-3 py-2.5">Acheteur</th>
                  <th className="text-left px-3 py-2.5">Date vente</th>
                  <th className="text-left px-3 py-2.5">Date OUT</th>
                  <th className="text-left px-3 py-2.5">Statut</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const oc = OUTCOME[it.outcome] || { label: it.outcome, cls: 'bg-surface-2' }
                  return (
                    <tr key={it.id} className="border-b last:border-0 hover:bg-surface-hover/50">
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-ink">{fmt(it.remise_date)}</td>
                      <td className="px-3 py-2 text-ink">{it.vehicle || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-secondary">{it.vin}</td>
                      <td className="px-3 py-2 text-ink-secondary">{it.pv_remise_name || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {it.matched_mission_id
                          ? <Link href={`/dispatch/${it.matched_mission_id}`} className="text-brand font-semibold hover:underline">
                              {it.mission_number ? `#${it.mission_number}` : 'Voir'}{it.plate ? ` · ${it.plate}` : ''}
                            </Link>
                          : <span className="text-ink-faint">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {it.zone ? <span className="px-2 py-0.5 rounded bg-surface-2 border text-xs font-semibold">{it.zone}</span> : <span className="text-ink-faint">—</span>}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary">{it.firm || <span className="text-ink-faint">—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-secondary">{it.vente_date ? fmt(it.vente_date) : <span className="text-ink-faint">—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-secondary">{it.date_out ? fmt(it.date_out) : <span className="text-ink-faint">—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded text-[11px] font-medium ${oc.cls}`}>{oc.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}

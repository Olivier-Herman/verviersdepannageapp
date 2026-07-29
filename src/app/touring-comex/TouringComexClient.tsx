'use client'

import { useEffect, useMemo, useState } from 'react'
import AppShell from '@/components/layout/AppShell'

interface Row {
  id: string; account: string; dossier: string; commande: string; prestation: string
  plaque: string; km: number; montant: number; insurer: string; brand: string; model: string
  mission_id: string | null; mission_number: number | null; mission_status: string | null
  vd_montant: number | null; verdict: string
  fiche_count?: number; fiches?: { number: number; type: string; montant: number | null }[]
}

const eur = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toFixed(2)} €`

export default function TouringComexClient(props: {
  userRole: string; userName: string; userEmail: string; userModules: string[]
}) {
  const [rows, setRows]       = useState<Row[]>([])
  const [counts, setCounts]   = useState<any>({ total: 0, ok: 0, verify: 0, noMatch: 0 })
  const [lastSync, setLast]   = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [sel, setSel]         = useState<Set<string>>(new Set())
  const [toast, setToast]     = useState<string | null>(null)

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500) }

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const j = await fetch('/api/touring/comex-bko/list').then(r => r.json())
      if (!j.error) { setRows(j.rows || []); setCounts(j.counts || {}); setLast(j.lastSync || null) }
    } finally { if (!silent) setLoading(false) }
  }
  // À l'ouverture de la page : synchro automatique (login BKO + refresh) puis
  // affichage. Plus besoin de cliquer « Synchroniser ». Olivier 2026-07-28.
  useEffect(() => { sync() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function sync() {
    setBusy('sync')
    try {
      const j = await fetch('/api/touring/comex-bko/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }),
      }).then(r => r.json())
      if (j.ok) flash(`🔄 Synchro : ${j.comex} dossier(s), ${j.matched} rapproché(s)`)
      else flash(`⚠ ${j.error || 'échec synchro'}`)
    } catch { flash('⚠ Erreur réseau') }
    finally { setBusy(null); await load() }   // toujours afficher la table (à jour via cron)
  }

  const toggle = (id: string) => setSel(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  async function accept(ids: string[]) {
    if (!ids.length) return
    const okRows = rows.filter(r => ids.includes(r.id))
    const nbVerify = okRows.filter(r => r.verdict !== 'ok').length
    const warn = nbVerify > 0 ? `\n\n⚠ ${nbVerify} dossier(s) NON conforme(s) (Touring < VD Soft) sont dans la sélection.` : ''
    if (!confirm(`Accepter ${ids.length} dossier(s) ?\n\nCela VALIDE dans Touring COMEX BKO et déclenche l'auto-facturation VD Soft.${warn}`)) return
    setBusy('accept')
    try {
      const j = await fetch('/api/touring/comex-bko/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      }).then(r => r.json())
      if (j.ok) {
        const fails = (j.results || []).filter((r: any) => !r.ok)
        flash(`✅ ${j.accepted}/${j.total} accepté(s)${fails.length ? ` · ⚠ ${fails.length} échec(s)` : ''}`)
        setSel(new Set()); await load()
      } else flash(`⚠ ${j.error || 'échec'}`)
    } catch { flash('⚠ Erreur réseau') } finally { setBusy(null) }
  }

  const selectableOk = useMemo(() => rows.filter(r => r.verdict === 'ok').map(r => r.id), [rows])

  const VD_STATUS: Record<string, string> = {
    new: '🆕 Nouvelle', dispatching: '📡 Dispatch', assigned: '🚚 Assignée', accepted: '✅ Acceptée',
    in_progress: '🔧 En cours', delivering: '🚚 Livraison', parked: '🅿️ En parc',
    completed: '✔️ Terminée', invoiced: '🧾 Facturée', to_invoice: '💰 À facturer',
  }
  // Facturable = rapprochée à une (ou des) fiche(s) to_invoice.
  const facturable = (r: Row) => r.verdict === 'ok' || r.verdict === 'verify'

  const Badge = ({ r }: { r: Row }) =>
    r.verdict === 'ok'     ? <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500 text-white">🟢 OK</span>
  : r.verdict === 'verify' ? <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-500 text-white">🔴 Vérifier</span>
  : r.verdict === 'status' ? <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-2 border text-ink-secondary">{VD_STATUS[r.mission_status || ''] || r.mission_status || '—'}</span>
  :                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-ink-faint text-white">⚪ Pas dans VD Soft</span>

  return (
    <AppShell title="Touring COMEX" userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userModules={props.userModules}>
      <main className="p-4 lg:p-6 space-y-4 max-w-6xl mx-auto">
        {toast && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-surface border shadow-lg rounded-xl px-4 py-2 text-sm font-medium text-ink">{toast}</div>}

        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-ink text-2xl font-bold">🅣 Touring COMEX</h1>
            <p className="text-ink-muted text-sm mt-1">
              Dossiers en attente dans COMEX BKO, rapprochés aux fiches VD Soft. Tarif Touring vs VD Soft.
            </p>
          </div>
          <button onClick={sync} disabled={busy === 'sync'}
            className="px-4 py-2 bg-surface-2 border rounded-xl text-ink-secondary hover:text-ink text-sm font-semibold transition disabled:opacity-50">
            {busy === 'sync' ? '🔄 Synchro…' : '🔄 Synchroniser'}
          </button>
        </div>

        {/* Résumé */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-surface border text-ink font-semibold">{counts.total} en attente</span>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-100 border border-emerald-400 text-emerald-800 font-semibold">🟢 {counts.ok} OK</span>
          <span className="px-2.5 py-1 rounded-lg bg-red-100 border border-red-300 text-red-800 font-semibold">🔴 {counts.verify} à vérifier</span>
          <span className="px-2.5 py-1 rounded-lg bg-surface-2 border text-ink-secondary font-semibold">⚪ {counts.noMatch} non rapprochés</span>
          {lastSync?.at && <span className="px-2.5 py-1 text-ink-faint">màj {new Date(lastSync.at).toLocaleTimeString('fr-BE')}</span>}
        </div>

        {/* Barre de sélection */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setSel(new Set(selectableOk))} disabled={!selectableOk.length}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 border text-ink-secondary disabled:opacity-50">
            Tout sélectionner (🟢 {selectableOk.length})
          </button>
          {sel.size > 0 && (
            <button onClick={() => setSel(new Set())} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 border text-ink-secondary">Désélectionner</button>
          )}
          <div className="flex-1" />
          <button onClick={() => accept([...sel])} disabled={!sel.size || busy === 'accept'}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-40">
            {busy === 'accept' ? 'Traitement…' : `✅ Accepter la sélection (${sel.size})`}
          </button>
        </div>

        {loading ? (
          <p className="text-ink-muted py-10 text-center">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="text-ink-muted py-10 text-center">Aucun dossier en attente dans COMEX BKO.</p>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="text-ink-muted text-xs uppercase tracking-wide border-b">
                  <th className="p-2 w-8"></th>
                  <th className="p-2 text-left">Dossier</th>
                  <th className="p-2 text-left">Véhicule</th>
                  <th className="p-2 text-left">Assureur</th>
                  <th className="p-2 text-left">Compte</th>
                  <th className="p-2 text-right">Touring</th>
                  <th className="p-2 text-right">VD Soft</th>
                  <th className="p-2 text-right">Δ</th>
                  <th className="p-2 text-center">Statut</th>
                  <th className="p-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const delta = r.vd_montant != null ? r.montant - Number(r.vd_montant) : null
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-surface-hover">
                      <td className="p-2 text-center">
                        {facturable(r) && (
                          <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)}
                            className="w-4 h-4 accent-emerald-600" />
                        )}
                      </td>
                      <td className="p-2">
                        <div className="font-mono text-ink font-semibold">{r.dossier}</div>
                        <div className="text-ink-faint text-[11px]">{r.commande} · {r.prestation}</div>
                        {r.fiches && r.fiches.length > 0 ? (
                          <div className="text-[11px] mt-0.5">
                            {(r.fiche_count || 0) > 1 && <span className="px-1.5 py-0.5 rounded bg-purple-600/15 text-purple-500 font-semibold mr-1">🔗 {r.fiche_count} fiches</span>}
                            <span className="text-ink-secondary">{r.fiches.map(f => `#${f.number}${f.montant != null ? ` (${Number(f.montant).toFixed(0)}€)` : ''}`).join(' + ')}</span>
                          </div>
                        ) : r.mission_number ? <div className="text-ink-faint text-[11px]">VD #{r.mission_number}</div> : null}
                      </td>
                      <td className="p-2">
                        <div className="font-mono text-ink-secondary">{r.plaque || '—'}</div>
                        <div className="text-ink-faint text-[11px]">{[r.brand, r.model].filter(Boolean).join(' ') || '—'}</div>
                      </td>
                      <td className="p-2 text-ink-secondary text-xs">{r.insurer || '—'}</td>
                      <td className="p-2 text-ink-faint text-[11px]">{r.account}</td>
                      <td className="p-2 text-right font-semibold text-ink tabular-nums">{eur(r.montant)}</td>
                      <td className="p-2 text-right text-ink-secondary tabular-nums">{eur(r.vd_montant)}</td>
                      <td className={`p-2 text-right tabular-nums font-medium ${delta == null ? 'text-ink-faint' : delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`}
                      </td>
                      <td className="p-2 text-center"><Badge r={r} /></td>
                      <td className="p-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {r.mission_id && (
                            <a href={`/dispatch/${r.mission_id}`} target="_blank" rel="noopener noreferrer"
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 border text-ink-secondary hover:text-ink transition whitespace-nowrap"
                              title="Ouvrir la fiche VD Soft dans un nouvel onglet">
                              👁 Aperçu dossier VD Soft
                            </a>
                          )}
                          {facturable(r) ? (
                            <button onClick={() => accept([r.id])} disabled={busy === 'accept'}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-40 ${r.verdict === 'ok' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-surface-2 border text-ink-secondary hover:text-ink'}`}>
                              Accepter
                            </button>
                          ) : (
                            <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 border text-ink-faint whitespace-nowrap">
                              {r.verdict === 'status' ? (VD_STATUS[r.mission_status || ''] || r.mission_status || '—') : 'non rapproché'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-ink-faint text-xs">
          🟢 = Touring ≥ VD Soft (tolérance 3 %) → validable · 🔴 = Touring &lt; VD Soft → à vérifier ·
          « Accepter » valide dans COMEX BKO <b>et</b> déclenche l'auto-facturation VD Soft.
        </p>
      </main>
    </AppShell>
  )
}

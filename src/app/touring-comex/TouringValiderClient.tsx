'use client'

// « Touring à valider » — nouvel habillage de l'écran Touring COMEX (préversion
// `ma_journee`, Olivier seul, 11/11/2026, maquette QVR1rR2Ab5Ksxvqg5iijpg).
// MÊMES fonctions que TouringComexClient (synchro à l'ouverture, rafraîchissement
// 15 s, compteurs, sélection des verts, acceptation en lot ou à l'unité, rouges
// acceptables, fiches liées, aperçu du dossier, état de la fiche non facturable)
// et mêmes API. Ce qui change : toute la ligne verte ou rouge, les deux montants
// dessinés, les compteurs servent de filtres, le bouton du lot annonce nombre et
// total (plus de fenêtre « Êtes-vous sûr ? »), un rouge demande un 2e appui.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, X, Minus, RefreshCw, ExternalLink } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'

interface Row {
  id: string; account: string; dossier: string; commande: string; prestation: string
  plaque: string; km: number; montant: number; insurer: string; brand: string; model: string
  mission_id: string | null; mission_number: number | null; mission_status: string | null
  vd_montant: number | null; verdict: string
  fiche_count?: number; fiches?: { number: number; type: string; montant: number | null }[]
}
type F = 'all' | 'ok' | 'verify' | 'other'

const eur = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const VD_STATUS: Record<string, string> = {
  new: 'Nouvelle', dispatching: 'Au dispatch', assigned: 'Assignée', accepted: 'Acceptée',
  in_progress: 'En cours', delivering: 'En livraison', parked: 'Au parc',
  completed: 'Terminée', invoiced: 'Facturée', to_invoice: 'À facturer',
}
const facturable = (r: Row) => r.verdict === 'ok' || r.verdict === 'verify'
const kindOf = (r: Row): 'ok' | 'verify' | 'other' => r.verdict === 'ok' ? 'ok' : r.verdict === 'verify' ? 'verify' : 'other'

export default function TouringValiderClient(props: { userRole: string; userName: string; userEmail: string; userModules: string[] }) {
  const [rows, setRows]     = useState<Row[]>([])
  const [lastSync, setLast] = useState<any>(null)
  const [coupure, setCoupure] = useState<{ depuis: string | null; erreur: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState<string | null>(null)
  const [sel, setSel]       = useState<Set<string>>(new Set())
  const [toast, setToast]   = useState<string | null>(null)
  const [filter, setFilter] = useState<F>('all')
  const [armed, setArmed]   = useState<string | null>(null)   // id d'un rouge, ou 'lot'

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4500) }
  useEffect(() => { try { const f = new URLSearchParams(window.location.search).get('f'); if (f === 'ok' || f === 'verify' || f === 'other') setFilter(f) } catch {} }, [])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const j = await fetch('/api/touring/comex-bko/list', { cache: 'no-store' }).then(r => r.json())
      if (!j.error) { setRows(j.rows || []); setLast(j.lastSync || null); setCoupure(j.coupure || null) }
    } finally { if (!silent) setLoading(false) }
  }
  // Synchro à l'ouverture (Olivier 28/07/2026), puis rafraîchissement 15 s + retour sur l'onglet (30/07/2026).
  useEffect(() => { sync() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const iv = setInterval(() => load(true), 15000)
    const onVis = () => { if (document.visibilityState === 'visible') load(true) }
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function sync() {
    setBusy('sync')
    try {
      const j = await fetch('/api/touring/comex-bko/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) }).then(r => r.json())
      if (j.ok) flash(`Synchro : ${j.comex} dossier(s), ${j.matched} rapproché(s)`)
      else flash(`⚠ ${j.error || 'échec de la synchro'}`)
    } catch { flash('⚠ Erreur réseau') }
    finally { setBusy(null); await load() }
  }

  async function accept(ids: string[]) {
    if (!ids.length) return
    setArmed(null); setBusy('accept')
    try {
      const j = await fetch('/api/touring/comex-bko/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).then(r => r.json())
      if (j.ok) {
        const fails = (j.results || []).filter((r: any) => !r.ok)
        flash(`✓ ${j.accepted}/${j.total} accepté(s) chez Touring, facture lancée${fails.length ? ` · ⚠ ${fails.length} échec(s)` : ''}`)
        setSel(new Set()); await load()
      } else flash(`⚠ ${j.error || 'échec'}`)
    } catch { flash('⚠ Erreur réseau') } finally { setBusy(null) }
  }

  const toggle = (id: string) => { setArmed(null); setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const counts = useMemo(() => ({ all: rows.length, ok: rows.filter(r => kindOf(r) === 'ok').length, verify: rows.filter(r => kindOf(r) === 'verify').length, other: rows.filter(r => kindOf(r) === 'other').length }), [rows])
  const greens = useMemo(() => rows.filter(r => r.verdict === 'ok').map(r => r.id), [rows])
  const shown = rows.filter(r => filter === 'all' || kindOf(r) === filter)
  const selRows = rows.filter(r => sel.has(r.id))
  const selTotal = selRows.reduce((s, r) => s + Number(r.montant || 0), 0)
  const selRed = selRows.filter(r => r.verdict !== 'ok').length

  const FILTERS: { k: F; label: string; cls: string }[] = [
    { k: 'all',    label: 'en attente',      cls: 'bg-surface text-ink' },
    { k: 'ok',     label: 'd’accord',        cls: 'bg-emerald-50 text-emerald-800' },
    { k: 'verify', label: 'à vérifier',      cls: 'bg-red-50 text-red-800' },
    { k: 'other',  label: 'non rapprochés ou pas encore facturables', cls: 'bg-stone-100 text-stone-700' },
  ]

  return (
    <AppShell title="Touring à valider" userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userModules={props.userModules}>
      <main className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto pb-6">
        {toast && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-surface border shadow-lg rounded-xl px-4 py-2 text-sm font-medium text-ink">{toast}</div>}
        <Link href="/facturation/dossiers" className="text-ink-muted text-sm hover:text-ink">← À facturer</Link>

        <div className="rounded-3xl text-white shadow-md p-5 lg:p-7 flex flex-wrap items-end gap-4 bg-[radial-gradient(120%_160%_at_100%_0%,#6d111c_0%,#17110f_62%)]">
          <div className="flex-1 min-w-[260px]">
            <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight">Touring à valider</h1>
            <p className="text-white/75 text-sm mt-1 max-w-2xl">Dossiers en attente chez Touring, rapprochés de nos fiches. <b className="text-emerald-300">Vert</b> : Touring paie au moins notre tarif (tolérance 3 %). <b className="text-red-300">Rouge</b> : Touring paie moins.</p>
          </div>
          <div className="flex items-center gap-3">
            {lastSync?.at && <span className="text-white/70 text-xs">mis à jour à {new Date(lastSync.at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={sync} disabled={busy === 'sync'} className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-white/30 bg-white/10 hover:bg-white/20 text-sm font-semibold disabled:opacity-50">
              <RefreshCw size={16} className={busy === 'sync' ? 'animate-spin' : ''} />{busy === 'sync' ? 'Synchro…' : 'Synchroniser'}
            </button>
          </div>
        </div>

        {coupure && (
          <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 text-red-800 px-4 py-3">
            <b>Connexion à Touring coupée{coupure.depuis ? ` depuis le ${new Date(coupure.depuis).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''} : la liste n'est pas à jour.</b>
            <span className="block text-sm mt-0.5">Les dossiers arrivés chez Touring depuis n'apparaissent pas ici. « Synchroniser » réessaie ; si ça persiste, les accès Touring sont à vérifier.</span>
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {FILTERS.map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)} className={`text-left rounded-2xl px-4 py-3 min-h-[76px] border-2 shadow-sm ${f.cls} ${filter === f.k ? 'border-current' : 'border-transparent'}`}>
              <b className="block text-3xl font-extrabold leading-none tabular-nums">{loading ? '…' : counts[f.k]}</b>
              <span className="text-[12.5px] font-semibold">{f.label}</span>
            </button>
          ))}
        </div>

        {loading ? <p className="text-ink-muted py-10 text-center">Chargement…</p>
        : shown.length === 0 ? <p className="text-ink-muted py-10 text-center bg-surface border rounded-2xl">{rows.length ? 'Plus rien dans ce filtre.' : 'Aucun dossier en attente chez Touring.'}</p>
        : (
          <div className="space-y-2">
            {shown.map(r => {
              const k = kindOf(r)
              const delta = r.vd_montant != null ? Number(r.montant) - Number(r.vd_montant) : null
              const mx = Math.max(Number(r.montant || 0), Number(r.vd_montant || 0)) || 1
              const tone = k === 'ok' ? 'border-emerald-300 border-l-emerald-600 bg-gradient-to-r from-emerald-50 to-surface to-60%'
                : k === 'verify' ? 'border-red-300 border-l-red-600 bg-gradient-to-r from-red-50 to-surface to-60%' : 'border-stone-200 border-l-stone-400 bg-stone-50'
              return (
                <div key={r.id} className={`grid gap-3 items-center border border-l-[8px] rounded-2xl px-4 py-3 grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[32px_minmax(0,1.3fr)_minmax(0,.8fr)_minmax(0,.8fr)_minmax(0,1.7fr)_auto] ${tone}`}>
                  <div>{facturable(r) && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner ${r.dossier}`} className="w-5 h-5 accent-emerald-600" />}</div>
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-ink">{r.dossier}</div>
                    <div className="text-ink-faint text-xs">{r.commande} · {r.prestation}{r.km > 0 ? ` · ${r.km} km chez Touring` : ''}</div>
                    {r.fiches && r.fiches.length > 0 ? (
                      <div className="text-xs mt-0.5">
                        {(r.fiche_count || 0) > 1 && <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 font-bold mr-1">{r.fiche_count} fiches</span>}
                        <span className="text-ink-secondary">{r.fiches.map(f => `#${f.number}${f.montant != null ? ` (${Number(f.montant).toFixed(0)} €)` : ''}`).join(' + ')}</span>
                      </div>
                    ) : r.mission_number ? <div className="text-ink-faint text-xs">VD #{r.mission_number}</div> : null}
                  </div>
                  <div className="min-w-0"><span className="font-mono font-bold text-[13px] border rounded-md px-1.5 bg-surface">{r.plaque || '—'}</span><div className="text-ink-faint text-xs">{[r.brand, r.model].filter(Boolean).join(' ') || '—'}</div></div>
                  <div className="min-w-0 col-start-2 xl:col-start-auto"><div className="text-ink-secondary text-sm">{r.insurer || '—'}</div><div className="text-ink-faint text-xs">{r.account}</div></div>
                  <div className="min-w-0 col-span-3 xl:col-span-1 space-y-1">
                    {k === 'ok' && <div className="flex items-center gap-2 flex-wrap"><span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-[13px] font-extrabold pl-1.5 pr-2.5 py-0.5"><Check size={14} />D’accord</span><b className="text-lg tabular-nums">{eur(r.montant)}</b>{delta != null && Math.abs(delta) >= 0.005 ? <span className="text-xs text-emerald-800 font-semibold tabular-nums">VD Soft {eur(r.vd_montant)} · {delta > 0 ? '+' : '−'}{eur(Math.abs(delta))}</span> : <span className="text-xs text-ink-faint">Touring = VD Soft</span>}</div>}
                    {k === 'verify' && <>
                      <div className="flex items-center gap-2 flex-wrap"><span className="inline-flex items-center gap-1 rounded-full bg-red-600 text-white text-[13px] font-extrabold pl-1.5 pr-2.5 py-0.5"><X size={14} />À vérifier</span>{delta != null && <span className="rounded-lg bg-red-600 text-white text-[13px] font-extrabold px-2 py-0.5 tabular-nums">{delta < 0 ? '−' : '+'}{eur(Math.abs(delta))}</span>}</div>
                      {[['Touring', r.montant, 'bg-red-500'], ['VD Soft', r.vd_montant, 'bg-stone-500']].map(([l, v, c]) => (
                        <div key={l as string} className="grid grid-cols-[58px_minmax(0,1fr)_auto] gap-2 items-center text-xs">
                          <span className="text-ink-secondary">{l}</span>
                          <div className="h-3 rounded bg-surface-2 border overflow-hidden"><i className={`block h-full ${c}`} style={{ width: `${(Number(v || 0) / mx) * 100}%` }} /></div>
                          <b className="tabular-nums text-sm">{eur(v as number)}</b>
                        </div>))}
                    </>}
                    {k === 'other' && <div className="flex items-center gap-2 flex-wrap"><span className="inline-flex items-center gap-1 rounded-full bg-stone-500 text-white text-[13px] font-extrabold pl-1.5 pr-2.5 py-0.5"><Minus size={14} />{r.verdict === 'status' ? (VD_STATUS[r.mission_status || ''] || r.mission_status || '—') : 'Pas dans VD Soft'}</span><b className="text-lg tabular-nums">{eur(r.montant)}</b></div>}
                  </div>
                  <div className="col-span-3 xl:col-span-1 flex items-center gap-2 flex-wrap xl:justify-end">
                    {r.mission_id && <a href={`/dispatch/${r.mission_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border bg-surface text-sm font-semibold text-ink hover:bg-surface-hover"><ExternalLink size={15} />Aperçu du dossier</a>}
                    {facturable(r) ? (
                      r.verdict === 'ok'
                        ? <button onClick={() => accept([r.id])} disabled={busy === 'accept'} className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">Accepter</button>
                        : armed === r.id
                          ? <><button onClick={() => accept([r.id])} disabled={busy === 'accept'} className="min-h-[44px] px-4 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">Confirmer malgré l’écart</button><button onClick={() => setArmed(null)} className="min-h-[44px] px-3 rounded-xl border bg-surface text-sm font-semibold">Annuler</button></>
                          : <button onClick={() => setArmed(r.id)} className="min-h-[44px] px-4 rounded-xl text-sm font-bold border bg-surface text-ink hover:bg-surface-hover">Accepter</button>
                    ) : <span className="min-h-[44px] inline-flex items-center px-3 rounded-xl text-xs font-semibold border bg-surface text-ink-faint">{r.verdict === 'status' ? (VD_STATUS[r.mission_status || ''] || r.mission_status || '—') : 'non rapproché'}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-ink-faint text-xs">« Accepter » valide le dossier chez Touring <b>et</b> lance la facture VD Soft.</p>

        {/* Barre du lot, collée en bas de l'écran */}
        <div className="sticky z-40" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
          <div>
            <div className="flex items-center gap-2 flex-wrap bg-surface border rounded-2xl shadow-lg px-3 py-2.5">
              <button onClick={() => { setArmed(null); setSel(new Set(greens)) }} disabled={!greens.length} className="min-h-[44px] px-3.5 rounded-xl border bg-surface text-sm font-semibold text-ink disabled:opacity-40">Tout sélectionner les verts ({greens.length})</button>
              {sel.size > 0 && <button onClick={() => { setArmed(null); setSel(new Set()) }} className="min-h-[44px] px-3.5 rounded-xl border bg-surface text-sm font-semibold text-ink">Désélectionner</button>}
              {selRed > 0 && <span className="rounded-lg bg-red-600 text-white text-xs font-extrabold px-2 py-1">dont {selRed} avec écart</span>}
              <div className="flex-1" />
              {armed === 'lot' && <button onClick={() => setArmed(null)} className="min-h-[44px] px-3.5 rounded-xl border bg-surface text-sm font-semibold">Annuler</button>}
              <button
                onClick={() => (selRed > 0 && armed !== 'lot') ? setArmed('lot') : accept([...sel])}
                disabled={!sel.size || busy === 'accept'}
                className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white disabled:opacity-40 ${armed === 'lot' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                <Check size={16} />
                {busy === 'accept' ? 'Traitement…' : !sel.size ? 'Accepter la sélection' : armed === 'lot' ? `Confirmer ${sel.size} dont ${selRed} avec écart` : `Accepter ${sel.size} dossier${sel.size > 1 ? 's' : ''} · ${eur(selTotal)}`}
              </button>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  )
}

'use client'
// Module Facturation par dossier — écran. Une ligne = un dossier. Onglets :
// À facturer / Éligibles auto / En cours / Facturées. Clic = détail (groupes +
// factures). « Facturer » ouvre la modale partagée. Olivier 07/09/2026.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Dossier, DossierLeg } from '@/lib/dossier/build'
import BillingModal, { cleanRef, isLegBilled, canPickLeg } from '@/components/dossier/BillingModal'

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtDay = (v: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : ''
const L_KIND: Record<DossierLeg['kind'], string> = {
  rem: 'bg-blue-600 text-white border-blue-700', gard: 'bg-amber-500 text-white border-amber-600',
  rel: 'bg-emerald-600 text-white border-emerald-700', out: 'bg-violet-600 text-white border-violet-700',
}
const AUTO_MAX = 500

const ready  = (d: Dossier) => d.legs.filter(l => canPickLeg(l) && !(l.kind === 'gard' && l.open))
const isDone = (d: Dossier) => d.legs.every(l => isLegBilled(l) || !!l.nothing_to_bill || l.amount_htva === 0)
const rest   = (d: Dossier) => d.totals.remaining

export default function DossiersClient({ initial, autoById, isSuperadmin, capped }: { initial: Dossier[]; autoById: Record<string, boolean>; isSuperadmin: boolean; capped: boolean }) {
  const [rows, setRows] = useState<Dossier[]>(initial)
  const [tab, setTab] = useState<'todo' | 'auto' | 'live' | 'done'>('todo')
  const [src, setSrc] = useState<string>('Tous')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [billing, setBilling] = useState<Dossier | null>(null)

  const isAuto = (d: Dossier) => !d.state.open && !isDone(d) && ready(d).length > 0 && !!autoById[d.root_id] && rest(d) <= AUTO_MAX
  const TABS: Array<[typeof tab, string, (d: Dossier) => boolean]> = [
    ['todo', 'À facturer', d => !isDone(d)],
    ['auto', 'Éligibles auto', d => isAuto(d)],
    ['live', 'En cours', d => d.state.open && !isDone(d)],
    ['done', 'Facturées', d => isDone(d)],
  ]
  const sources = useMemo(() => ['Tous', ...Array.from(new Set(rows.map(d => d.source_label))).sort()], [rows])
  const visible = rows.filter(TABS.find(t => t[0] === tab)![2]).filter(d => src === 'Tous' || d.source_label === src)
  const todo = rows.filter(d => !isDone(d))

  const refreshOne = async (rootId: string) => {
    try {
      const j = await fetch(`/api/dossier/${rootId}?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
      if (j?.dossier) setRows(p => p.map(d => d.root_id === rootId ? j.dossier : d))
    } catch {}
  }

  return (
    <div className="px-3 lg:px-6 py-5 space-y-3">
      {isSuperadmin && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2 text-xs text-amber-700 dark:text-amber-300 font-semibold flex flex-wrap justify-between gap-2">
          <span>🧪 Preview « Facturation par dossier » — visible par toi seul. Le module Facturation actuel n'est pas modifié.</span>
          <Link href="/facturation" className="underline">← Facturation actuelle</Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Reste à facturer" value={eur(todo.reduce((s, d) => s + rest(d), 0))} />
        <Kpi label="Éligibles au prochain cron" value={String(rows.filter(isAuto).length)} />
        <Kpi label="Dossiers en cours (parc / relivraison)" value={String(rows.filter(d => d.state.open && !isDone(d)).length)} />
        <Kpi label="Partiel possible maintenant" value={String(rows.filter(d => d.state.open && ready(d).length > 0).length)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(([k, lbl, f]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${tab === k ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-secondary'}`}>{lbl} <span className="opacity-70">{rows.filter(f).length}</span></button>
        ))}
        <select value={src} onChange={e => setSrc(e.target.value)} className="ml-auto border rounded-lg px-2.5 py-1.5 bg-surface text-xs text-ink">
          {sources.map(s => <option key={s} value={s}>{s === 'Tous' ? 'Source : toutes' : s}</option>)}
        </select>
      </div>

      {visible.length === 0 && <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">Rien dans cet onglet.</div>}

      {visible.map(d => {
        const rd = ready(d); const isOpen = open.has(d.root_id)
        const clients = Array.from(new Set(d.legs.filter(l => !isLegBilled(l) && !l.nothing_to_bill).map(l => l.billed_to_name || '—')))
        const badge = isDone(d) ? ['bg-surface-2 text-ink-muted border', 'Facturé']
          : isAuto(d) ? ['bg-emerald-600 text-white', '🎯 Éligible auto']
          : d.state.open ? ['bg-blue-600 text-white', 'En cours']
          : ['bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', 'Prêt · manuel']
        return (
          <div key={d.root_id} className="bg-surface border rounded-2xl overflow-hidden">
            <div onClick={() => setOpen(p => { const n = new Set(p); n.has(d.root_id) ? n.delete(d.root_id) : n.add(d.root_id); return n })}
              className="grid grid-cols-1 md:grid-cols-[minmax(200px,1.2fr)_minmax(160px,1fr)_minmax(200px,1.3fr)_110px_150px_auto] gap-3 items-center px-4 py-2.5 cursor-pointer hover:bg-surface-2/60">
              <div className="text-ink font-bold text-sm">{d.ref} · <span className="font-mono">{d.vehicle.plate}</span>
                <span className="block text-[11px] font-medium text-ink-muted">{[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ')} · {d.source_label}{d.legs.length === 1 ? ' · dépannage simple' : ''}</span></div>
              <div className="text-xs text-ink-secondary">{d.billed_to.name || '—'}
                <span className="block text-[11px] text-ink-muted">{clients.length > 1 ? `+ ${clients.filter(c => c !== d.billed_to.name).join(', ')}` : d.state.open ? d.state.reason : d.legs.some(l => l.ended_at) ? `terminé le ${fmtDay(d.legs[d.legs.length - 1].ended_at)}` : ''}</span></div>
              <div className="flex flex-wrap gap-1">
                {d.legs.map(l => (
                  <span key={l.letter} title={`${l.letter} ${l.title} · ${isLegBilled(l) ? 'facturé ' + cleanRef(l.billed_refs[0]) : l.nothing_to_bill ? l.nothing_to_bill : l.open && l.kind === 'gard' ? 'en cours' : 'prêt'}`}
                    className={`w-6 h-6 rounded-md border inline-flex items-center justify-center text-[11px] font-bold font-mono ${L_KIND[l.kind]} ${isLegBilled(l) ? 'opacity-35 line-through' : ''} ${l.open && l.kind === 'gard' ? 'border-dashed !bg-transparent !text-amber-700 dark:!text-amber-300' : ''} ${l.nothing_to_bill ? 'opacity-45' : ''}`}>{l.letter}</span>
                ))}
              </div>
              <div className="text-right font-semibold tabular-nums text-ink text-sm">{eur(rest(d))}<span className="block text-[10.5px] font-normal text-ink-muted">reste HTVA</span></div>
              <div><span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${badge[0]}`}>{badge[1]}</span></div>
              <div className="flex gap-1.5">
                <button disabled={!rd.length && !d.legs.some(l => canPickLeg(l))} onClick={e => { e.stopPropagation(); setBilling(d) }} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${rd.length ? 'bg-brand text-white' : 'border text-ink-secondary'} disabled:opacity-40`}>Facturer{d.state.open && rd.length ? ' (partiel)' : ''}</button>
                <Link href={`/dispatch/dossier/${d.root_id}`} onClick={e => e.stopPropagation()} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-ink-secondary hover:text-ink">Dossier ↗</Link>
              </div>
            </div>
            {isOpen && (
              <div className="border-t bg-surface-2 px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Groupes du dossier</p>
                  {d.legs.map(l => (
                    <div key={l.letter} className="grid grid-cols-[24px_1fr_auto_auto] gap-2 items-center py-1 border-t first:border-t-0 text-ink-secondary">
                      <span className="font-mono">{l.letter}</span>
                      <span>{l.title}{l.kind === 'gard' && l.days != null ? ` ${l.days} j` : ''}{l.billed_to_name !== d.billed_to.name ? <span className="text-ink-muted"> · → {l.billed_to_name || '?'}</span> : null}</span>
                      <span className="tabular-nums">{eur(l.amount_htva)}</span>
                      <span>{isLegBilled(l) ? <span className="px-1.5 py-0.5 rounded-full bg-surface border text-ink-muted font-mono">{cleanRef(l.billed_refs[0])}</span> : l.nothing_to_bill ? <span className="text-ink-faint">{l.nothing_to_bill}</span> : l.open && l.kind === 'gard' ? <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white">en cours</span> : <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">prêt</span>}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Factures du dossier</p>
                  {d.invoices.length ? d.invoices.map(i => (
                    <div key={i.number} className="flex items-center justify-between gap-2 py-1 border-t first:border-t-0">
                      <span>{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="text-brand font-mono hover:underline">{cleanRef(i.number)}</a> : <span className="font-mono">{cleanRef(i.number)}</span>} <span className="text-ink-muted">couvre {i.covers.join(' ')} · {i.client || '—'}{i.at ? ' · ' + fmtDay(i.at) : ''}</span></span>
                      <span className="tabular-nums">{eur(i.amount)}</span>
                    </div>
                  )) : <p className="text-ink-muted">Aucune facture pour l'instant.</p>}
                  {d.state.open && rd.length > 0 && <p className="mt-2 text-ink-muted border-l-2 pl-2">Dossier en cours ({d.state.reason}) : pas de facturation automatique. Tu peux facturer maintenant les groupes prêts ; le reste partira à la sortie du véhicule.</p>}
                  {isAuto(d) && <p className="mt-2 text-ink-muted border-l-2 pl-2">Sera facturé automatiquement au prochain cron : référence « {d.number} {rd.map(l => l.letter).join(' ')} ».</p>}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {capped && <p className="text-[11px] text-ink-faint px-1">Liste limitée aux 80 dossiers les plus récents.</p>}
      {billing && <BillingModal d={billing} onClose={() => setBilling(null)} onDone={() => refreshOne(billing.root_id)} />}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="bg-surface border rounded-xl px-3.5 py-2.5 text-[11px] text-ink-muted">{label}<b className="block text-lg text-ink tabular-nums font-semibold">{value}</b></div>
}

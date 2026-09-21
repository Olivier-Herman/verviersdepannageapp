'use client'
// src/app/facturation/dossiers/[id]/FactureDossierClient.tsx
//
// Écran « Facturation du dossier » allégé (Olivier 21/09/2026). Voir page.tsx.
//   • une ligne par prestation : lettre, quoi / qui / quand, POURQUOI ce montant,
//     montant HTVA + TVAC, état (facturé n° / à facturer / rien / en cours) ;
//   • une case à cocher par prestation, cochées d'office, verrouillées si déjà
//     facturées ; le total et le bouton suivent la sélection ;
//   • un seul bouton, qui dit combien de factures et pour qui, puis la modale
//     commune (vérification des lignes, création des brouillons Odoo).
//   Estimé / encaissé / reste ne s'affichent que s'il y a un encaissement sur
//   place ou un écart.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Dossier, DossierLeg } from '@/lib/dossier/build'
import BillingModal, { canPickLeg, isLegBilled, cleanRef } from '@/components/dossier/BillingModal'

const eur  = (n: number) => Number(n || 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const tvac = (n: number) => eur(Math.round(Number(n || 0) * 121) / 100)
const fmtDay = (v: string | null) => v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit' }) : ''

const KIND: Record<string, { bar: string; dot: string; label: string }> = {
  rem:  { bar: 'border-l-blue-600',    dot: 'bg-blue-600 text-white',    label: 'Remorquage / dépannage' },
  gard: { bar: 'border-l-amber-500',   dot: 'bg-amber-500 text-white',   label: 'Gardiennage' },
  rel:  { bar: 'border-l-emerald-600', dot: 'bg-emerald-600 text-white', label: 'Relivraison' },
  out:  { bar: 'border-l-violet-600',  dot: 'bg-violet-600 text-white',  label: 'Sortie' },
}

// Libellé humain d'une prestation : quoi · qui · quand · où.
function legTitle(l: DossierLeg) {
  const what = l.kind === 'gard'
    ? `Gardiennage${l.days != null ? ` · ${l.days} nuit${l.days > 1 ? 's' : ''}` : ''}`
    : l.title.replace(/^🚚\s*/, '').replace(/^REM\+REL$/, 'Remorquage').replace(/^REM$/, 'Remorquage').replace(/^DSP$/, 'Dépannage')
  const where = l.kind === 'rel' ? (l.facts.find(f => /livr/i.test(f.label))?.value || '').split(',').slice(-1)[0]?.trim() : ''
  return [what, l.driver_name, fmtDay(l.started_at), where].filter(Boolean).join(' · ')
}

// Le « pourquoi » du montant, en une ligne lisible.
function legWhy(l: DossierLeg) {
  if (l.nothing_to_bill) return l.nothing_to_bill
  if (l.kind === 'gard') {
    const sub = [l.regime ? `régime ${l.regime}` : null, l.subtitle?.match(/zone \S+/)?.[0] || null].filter(Boolean).join(' · ')
    return [l.amount_note, sub].filter(Boolean).join(' · ') || 'gardiennage'
  }
  if (l.amount_unknown) return l.amount_note || 'montant à calculer'
  return l.amount_note || ''
}

export default function FactureDossierClient({ initial }: { initial: Dossier }) {
  const [d, setD] = useState<Dossier>(initial)
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial.legs.filter(canPickLeg).map(l => l.mission_id)))
  const [billing, setBilling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [report, setReport] = useState<{ text: string; links: { url: string; label: string }[] } | null>(null)

  const refresh = async () => {
    setRefreshing(true)
    try {
      const j = await fetch(`/api/dossier/${d.root_id}?mode=list&t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json())
      if (j?.dossier) { setD(j.dossier); setSel(s => new Set([...s].filter(id => (j.dossier as Dossier).legs.some(l => l.mission_id === id && canPickLeg(l))))) }
    } catch {} finally { setRefreshing(false) }
  }

  const chosen = useMemo(() => d.legs.filter(l => sel.has(l.mission_id)), [d, sel])
  const total  = chosen.reduce((s, l) => s + Number(l.amount_htva || 0), 0)
  const clients = Array.from(new Set(chosen.map(l => l.billed_to_name || '?')))
  const missingClient = chosen.some(l => !l.billed_to_id)
  const pickable = d.legs.filter(canPickLeg)
  const billedTotal = d.legs.reduce((s, l) => s + Number(l.billed_htva || 0), 0)
  const collected = Number(d.totals.collected || 0)
  const vehicle = [d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ')
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="px-3 lg:px-6 py-5 space-y-4 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="bg-surface border rounded-2xl px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/facturation/dossiers" className="px-2.5 py-1 rounded-lg border bg-surface text-ink-secondary hover:text-ink text-sm font-semibold">← À facturer</Link>
          <h1 className="text-ink font-bold text-lg">Dossier {d.vehicle.plate ? <span className="font-mono">{d.vehicle.plate}</span> : d.ref}</h1>
          <span className="text-xs font-semibold text-ink-secondary bg-surface-2 border rounded-full px-2.5 py-0.5">{d.source_label}{d.dossier_number ? <> · <span className="font-mono">{d.dossier_number}</span></> : null}</span>
          <span className={`text-xs font-bold rounded-full px-2.5 py-0.5 ${d.cancelled ? 'bg-red-600/10 text-red-700 dark:text-red-300' : d.state.open ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300' : 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300'}`}>
            {d.cancelled ? 'Annulé' : d.state.open ? `En cours · ${d.state.reason}` : `Terminé${d.last_parc?.exited_at ? ` · véhicule parti le ${fmtDay(d.last_parc.exited_at)}` : ''}`}
          </span>
          <Link href={`/dispatch/dossier/${d.root_id}`} className="ml-auto text-xs text-ink-secondary hover:text-ink">Vue dossier complète ↗</Link>
        </div>
        <p className="text-ink-secondary text-sm mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {vehicle && <span>{vehicle}{d.vehicle.plate ? '' : ` · ${d.ref}`}</span>}
          <span>Client sur place : <b className="text-ink">{d.client.name || '—'}</b></span>
          <span>Facture à : {d.billed_to.name ? <b className="text-ink">{d.billed_to.name}</b> : <Link href={`/dispatch/dossier/${d.root_id}`} className="text-brand underline">à choisir dans la Vue dossier</Link>}</span>
        </p>
      </div>

      {report && (
        <div className="rounded-xl px-4 py-2.5 text-sm bg-emerald-600/10 border border-emerald-600/40 text-emerald-800 dark:text-emerald-300 flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-0">{report.text}</span>
          {report.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" className="underline font-semibold">{l.label} ↗</a>)}
          <button onClick={() => setReport(null)} className="text-ink-faint">✕</button>
        </div>
      )}

      {/* Une ligne par prestation */}
      <div className="space-y-2">
        {d.legs.map(l => {
          const billed = isLegBilled(l)
          const pick   = canPickLeg(l)
          const zero   = !billed && !pick && !!l.nothing_to_bill
          const muted  = l.kind === 'gard' && Number(l.amount_htva) === 0
          const k = KIND[l.kind] || KIND.rem
          const checked = sel.has(l.mission_id)
          return (
            <div key={l.mission_id} className={`bg-surface border border-l-[5px] ${k.bar} rounded-xl px-4 py-3 grid grid-cols-[24px_34px_1fr] md:grid-cols-[24px_34px_1fr_auto_auto] gap-x-3 gap-y-1 items-center ${muted && !checked ? 'opacity-70' : ''}`}>
              <button type="button" disabled={!pick} onClick={() => toggle(l.mission_id)} title={billed ? 'Déjà facturée' : zero ? 'Rien à facturer' : pick ? (checked ? 'Décocher pour la garder pour plus tard' : 'Cocher pour la facturer') : (l.amount_unknown ? 'Montant à calculer' : l.open ? 'En cours' : 'Pas facturable pour le moment')}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[12px] font-bold ${checked ? 'bg-emerald-600 border-emerald-600 text-white' : billed || zero ? 'border-dashed border-ink-faint text-ink-faint bg-surface-2' : pick ? 'border-ink-muted' : 'border-dashed border-ink-faint bg-surface-2'}`}>
                {checked ? '✓' : billed ? '✓' : zero ? '–' : ''}
              </button>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold ${k.dot}`}>{l.letter}</span>
              <div className="min-w-0">
                <p className="text-ink font-bold text-sm leading-tight">{legTitle(l)}</p>
                <p className="text-ink-secondary text-xs mt-0.5 leading-snug">{legWhy(l)}</p>
                {(l.alerts || []).map((a, i) => <p key={i} className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mt-0.5">⚠ {a}</p>)}
                {(l.payments || []).length > 0 && <p className="text-[11px] text-ink-muted mt-0.5">Encaissé sur place : {l.payments.map(p => `${eur(p.amount)}${p.mode ? ` (${p.mode})` : ''}${p.driver ? ` · ${p.driver}` : ''}`).join(' · ')}</p>}
                {(l.billing_remarks || []).map((r, i) => <p key={i} className="text-[11px] text-ink mt-1 bg-slate-800 text-white rounded-md px-2 py-1 inline-block">📝 {r.text}</p>)}
              </div>
              <div className="text-right col-start-3 md:col-start-4">
                <p className="text-ink font-bold text-base tabular-nums leading-tight">{l.amount_unknown && !billed ? '—' : eur(l.amount_htva)}</p>
                <p className="text-ink-muted text-[11px] tabular-nums">{l.amount_unknown && !billed ? 'à calculer' : muted && Number(l.amount_htva) === 0 ? 'rien' : `${tvac(l.amount_htva)} TVAC`}</p>
              </div>
              <div className="col-start-3 md:col-start-5 text-right">
                {billed ? <span className="inline-block font-mono text-[11px] font-semibold rounded-md px-2 py-1 border-[1.5px] border-emerald-600 text-emerald-700 dark:text-emerald-300 whitespace-nowrap">FACTURÉ {cleanRef(l.billed_refs[0])}</span>
                  : zero ? <span className="inline-block font-mono text-[11px] rounded-md px-2 py-1 border border-dashed text-ink-faint whitespace-nowrap">RIEN À FACTURER</span>
                  : l.open ? <span className="inline-block font-mono text-[11px] font-semibold rounded-md px-2 py-1 bg-blue-600/10 text-blue-700 dark:text-blue-300 whitespace-nowrap">EN COURS</span>
                  : l.amount_unknown ? <span className="inline-block font-mono text-[11px] font-semibold rounded-md px-2 py-1 bg-red-600/10 text-red-700 dark:text-red-300 whitespace-nowrap">À CALCULER</span>
                  : !l.billed_to_id ? <span className="inline-block font-mono text-[11px] font-semibold rounded-md px-2 py-1 bg-red-600/10 text-red-700 dark:text-red-300 whitespace-nowrap">CLIENT MANQUANT</span>
                  : <span className="inline-block font-mono text-[11px] font-semibold rounded-md px-2 py-1 bg-amber-500/15 text-amber-800 dark:text-amber-300 whitespace-nowrap">À FACTURER</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Sélection + bouton */}
      <div className="bg-surface border rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">{pickable.length ? `Sélection · ${chosen.length} prestation${chosen.length > 1 ? 's' : ''} sur ${pickable.length}` : 'Rien à facturer'}</p>
          <p className="text-ink font-bold text-2xl tabular-nums">{eur(total)} <span className="text-sm font-normal text-ink-muted">HTVA</span> <span className="text-sm font-normal text-ink-secondary">· {tvac(total)} TVAC</span></p>
          {missingClient && <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">Une prestation cochée n'a pas de client de facturation : choisis-le dans la Vue dossier.</p>}
        </div>
        <button disabled={!chosen.length || missingClient || refreshing} onClick={() => setBilling(true)}
          className="px-5 py-2.5 rounded-xl text-left bg-brand text-white font-bold disabled:opacity-40 hover:bg-brand-hover">
          {chosen.length === pickable.length && pickable.length > 1 ? 'Facturer le dossier' : chosen.length === 1 ? `Facturer ${legTitle(chosen[0]).split(' · ')[0].toLowerCase()}` : 'Facturer la sélection'}
          <span className="block text-xs font-normal opacity-90">{chosen.length ? `${clients.length} facture${clients.length > 1 ? 's' : ''} brouillon Odoo · ${clients.join(', ')}${chosen.length ? ` · ${chosen.map(l => l.letter).join(' + ')}` : ''}` : 'coche ce que tu veux facturer'}</span>
        </button>
      </div>

      <p className="text-[11px] text-ink-faint px-1">
        {billedTotal > 0 ? `Déjà facturé sur ce dossier : ${eur(billedTotal)} HTVA${d.invoices.length ? ` (${d.invoices.map(i => i.number).join(', ')})` : ''}. ` : ''}
        {collected > 0 ? `Encaissé sur place : ${eur(collected)} TVAC · reste dû ${eur(d.totals.due_tvac)} TVAC. ` : ''}
        {d.state.open ? 'Dossier en cours : la facturation automatique attend la sortie du véhicule. ' : ''}
        {refreshing ? 'Mise à jour…' : ''}
      </p>

      {billing && <BillingModal d={d} initialSelection={Array.from(sel)} onClose={() => setBilling(false)} onDone={async (res) => {
        if (res?.invoices?.length) {
          setBilling(false)
          setReport({ text: `✓ ${res.invoices.length} facture${res.invoices.length > 1 ? 's' : ''} brouillon créée${res.invoices.length > 1 ? 's' : ''} dans Odoo. Confirme-la dans Odoo, puis « Vérifier la facture » dans la liste.`, links: res.invoices.map((i: any) => ({ url: i.url, label: `${i.client_name} · ${Number(i.total_htva).toFixed(2)} € HTVA` })) })
        }
        await refresh()
      }} />}
    </div>
  )
}

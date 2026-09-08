'use client'
// Modale « Facturer le dossier » : groupes cochés par client, une facture Odoo
// par client créée directement en brouillon. Partagée entre la Vue dossier et
// le module Facturation par dossier. Olivier 07/09/2026.

import React, { useState } from 'react'
import type { Dossier, DossierLeg } from '@/lib/dossier/build'
import PushToScreenButton from '@/components/caisse/PushToScreenButton'

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
// TVAC = HTVA × 1,21 (TVA belge 21 %), arrondi au cent — affiché à côté du HTVA (Olivier 08/09/2026).
const tvac = (n: number) => eur(Math.round(n * 121) / 100)
export const cleanRef = (raw: string) => {
  const m = raw.match(/([0-9]{4}\/[0-9]{2}\/[0-9A-Z-]+|[0-9]{4}[A-Z]{1,3}[0-9]{3,}|[A-Z]{1,3}-?[0-9]{4,}[A-Z0-9-]*|[0-9]{6,})\s*$/i)
  return m ? m[1] : raw
}
const TONE = {
  ok: 'bg-emerald-600 text-white', warn: 'bg-amber-500 text-white', live: 'bg-blue-600 text-white', bad: 'bg-red-600 text-white',
} as const

export const isLegBilled = (l: DossierLeg) => l.billed_refs.length > 0 && l.billed_htva >= l.amount_htva - 0.01
// Groupe Parquet (saisie) : cochable dès qu'un client (le propriétaire) est choisi — on peut facturer
// le propriétaire sans levée de saisie ; seule la restitution l'exige (Olivier 08/09/2026).
export const canPickLeg  = (l: DossierLeg) => !l.nothing_to_bill && !isLegBilled(l) && l.amount_htva > 0
  && ((l.channel || 'odoo') === 'odoo' || (!!l.billed_to_id && !/parquet|frais de justice|fdj\b/i.test(String(l.billed_to_name || ''))))

export default function BillingModal({ d, onClose, onDone }: { d: Dossier; onClose: () => void; onDone: (result?: { invoices: any[]; warnings: string[] }) => Promise<void> | void }) {
  // Olivier 08/09/2026 : TOUT coché par défaut, gardiennage en cours compris ;
  // on décoche ce qu'on ne veut pas facturer. Pour un gardiennage en cours, on
  // choisit le dernier jour facturé : la période se ferme là et une nouvelle
  // s'ouvre le lendemain pour le solde.
  const [sel, setSel] = useState<Set<string>>(() => new Set(d.legs.filter(canPickLeg).map(l => l.mission_id)))
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' })
  const [periodTo, setPeriodTo] = useState<Record<string, string>>(() => Object.fromEntries(d.legs.filter(l => l.kind === 'gard' && l.open).map(l => [l.mission_id, today])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ invoices: any[]; warnings: string[] } | null>(null)
  // Garde-fou « Remarque de facturation » (même règle que le module actuel,
  // Olivier 2026-07-07) : si un groupe coché porte une remarque, on exige la
  // confirmation qu'elle a été prise en compte AVANT de créer la facture.
  const [remarkGate, setRemarkGate] = useState(false)
  // D1 (audit 08/09/2026) : étape « Vérifier les lignes » avant l'envoi — lignes
  // calculées par le serveur (dry-run), modifiables, sauvables en brouillon.
  type PLine = { kind: string; name: string; qty: number; price_unit: number }
  type PSection = { section_label?: string; lines: PLine[]; mission_id?: string }
  type PInvoice = { client_id: number; client_name: string; covers: string[]; total_htva: number; sections?: PSection[] }
  const [preview, setPreview] = useState<{ invoices: PInvoice[]; warnings: string[] } | null>(null)
  const [edited, setEdited] = useState<Record<string, PLine[]>>({})
  const [savingDraft, setSavingDraft] = useState(false)
  const KINDS: [string, string][] = [['SERV-PEC', 'Prise en charge'], ['SERV-KM', 'Kilomètres'], ['SERV-PARC', 'Gardiennage'], ['SERV-MAJ', 'Majoration'], ['SERV-DIV', 'Divers']]
  const evalNum = (raw: string, fallback: number) => { const t = String(raw).replace(/,/g, '.').replace(/\s+/g, ''); if (!/^-?[\d.+\-*/()]+$/.test(t)) return fallback; try { const v = Function(`"use strict"; return (${t})`)(); return Number.isFinite(v) ? Math.round(v * 100) / 100 : fallback } catch { return fallback } }
  const openPreview = async (close: boolean) => {
    setBusy(true); setError(null); setCloseMode(close)
    try {
      const ids = close ? Array.from(new Set([...chosen.map(l => l.mission_id), ...(openGard ? [openGard.mission_id] : [])])) : chosen.map(l => l.mission_id)
      const r = await fetch(`/api/dossier/${d.root_id}/invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_ids: ids, period_to: close ? undefined : periodTo, dry_run: true }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      const ed: Record<string, PLine[]> = {}
      for (const inv of j.invoices || []) for (const sec of inv.sections || []) if (sec.mission_id) ed[sec.mission_id] = (sec.lines || []).map((l: any) => ({ kind: l.kind, name: l.name, qty: Number(l.qty), price_unit: Number(l.price_unit) }))
      setEdited(ed); setPreview({ invoices: j.invoices || [], warnings: j.warnings || [] })
    } catch (e: any) { setError(String(e.message || e)) } finally { setBusy(false) }
  }
  const setLine = (mid: string, i: number, patch: Partial<PLine>) => setEdited(p => ({ ...p, [mid]: (p[mid] || []).map((l, k) => k === i ? { ...l, ...patch } : l) }))
  const delLine = (mid: string, i: number) => setEdited(p => ({ ...p, [mid]: (p[mid] || []).filter((_, k) => k !== i) }))
  const addLine = (mid: string) => setEdited(p => ({ ...p, [mid]: [...(p[mid] || []), { kind: 'SERV-DIV', name: '', qty: 1, price_unit: 0 }] }))
  const saveDrafts = async () => {
    setSavingDraft(true); setError(null)
    try { for (const [mid, lines] of Object.entries(edited)) { const r = await fetch(`/api/missions/${mid}/invoice-draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) }); if (!r.ok) throw new Error(`Brouillon non sauvé (${r.status})`) } setError(null); alert('Brouillons sauvés : ces lignes seront reprises à la prochaine facturation.') }
    catch (e: any) { setError(String(e.message || e)) } finally { setSavingDraft(false) }
  }
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const byClient = new Map<string, DossierLeg[]>()
  for (const l of d.legs) { const k = l.billed_to_name || '— client à définir'; (byClient.get(k) || byClient.set(k, []).get(k)!).push(l) }
  const chosen = d.legs.filter(l => sel.has(l.mission_id))
  const allPickable = d.legs.filter(canPickLeg)
  const total = chosen.reduce((s, l) => s + l.amount_htva, 0)
  const nInv = new Set(chosen.map(l => l.billed_to_id ?? 'none')).size
  const missingClient = chosen.some(l => !l.billed_to_id)
  const runningChosen = chosen.some(l => l.kind === 'gard' && l.open)

  // « Déjà facturé… » (facture faite à la main dans Odoo) et « Ne rien
  // facturer » (sans frais), sur les groupes cochés.
  const mark = async (action: 'already_billed' | 'no_charge' | 'auto_billed') => {
    const value = action === 'already_billed'
      ? window.prompt(`Numéro de la facture Odoo qui couvre ${chosen.map(l => l.letter).join(' ')} :`, '')
      : action === 'auto_billed'
        ? (window.confirm(`Marquer ${chosen.map(l => l.letter).join(' ')} comme autofacturé ?\n\nÀ utiliser quand la mission a été validée par nous dans COMEX : Touring s'autofacture, aucune facture Odoo n'est créée.`) ? 'auto' : null)
        : window.prompt(`Ne rien facturer pour ${chosen.map(l => l.letter).join(' ')} — motif :`, '')
    if (value === null || !value.trim()) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/dossier/${d.root_id}/mark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, mission_ids: chosen.map(l => l.mission_id), invoice_number: action === 'already_billed' ? value.trim() : undefined, period_to: action === 'already_billed' ? periodTo : undefined, reason: action === 'no_charge' ? value.trim() : undefined }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setResult({ invoices: [], warnings: [action === 'auto_billed' ? `Groupes ${j.covers.join(' ')} marqués autofacturés (validé COMEX).` : action === 'already_billed' ? `Groupes ${j.covers.join(' ')} marqués facturés sur ${value.trim()}${j.invoice ? ' (facture Odoo retrouvée)' : ' (numéro non retrouvé dans Odoo, à vérifier)'}.` : `Groupes ${j.covers.join(' ')} marqués sans frais : ${value.trim()}.`] })
      await onDone()
    } catch (e: any) { setError(String(e.message || e)) } finally { setBusy(false) }
  }
  const remarksOfChosen = () => chosen.flatMap(l => (l.billing_remarks || []).map(r => ({ label: `${d.number}${l.letter}`, ...r })))
  const askOrSubmit = () => { if (!preview) { openPreview(false); return } if (remarksOfChosen().length) setRemarkGate(true); else submit(false) }
  // « Clôturer et facturer » (Olivier 08/09/2026) : un transporteur vient
  // chercher le véhicule → sortie du parc maintenant (le gardiennage s'arrête
  // là), fiche à facturer, puis toutes les factures du dossier d'un coup.
  const openGard = d.legs.find(l => l.kind === 'gard' && l.open)
  const canCloseAndBill = !!openGard && d.legs.some(l => l.mission_id === d.root_id)
  const [closeMode, setCloseMode] = useState(false)
  const askClose = () => {
    if (!window.confirm(`Clôturer le dossier ${d.ref} maintenant ?\n\nLe véhicule ${d.vehicle.plate || ''} sort du parc à l'instant (enlèvement par un transporteur), le gardiennage s'arrête ici, la place est libérée, puis les factures sont créées, gardiennage compris.`)) return
    if (!preview) { openPreview(true); return }
    setCloseMode(true)
    if (remarksOfChosen().length || (openGard?.billing_remarks || []).length) setRemarkGate(true); else submit(true)
  }
  const [asQuote, setAsQuote] = useState(false)
  const submit = async (close = closeMode, quote = false) => {
    setRemarkGate(false)
    setBusy(true); setError(null)
    // Les factures s'ouvrent d'elles-mêmes dans un nouvel onglet (Olivier
    // 07/09 : « pas de clic supplémentaire »). Le navigateur ne laisse ouvrir
    // un onglet qu'au moment du clic : on les ouvre vides tout de suite, une par
    // client, puis on y met l'URL Odoo à la réponse.
    const nTabs = close ? new Set([...chosen, ...(openGard ? [openGard] : [])].map(l => l.billed_to_id ?? 'none')).size : nInv
    const tabs: (Window | null)[] = Array.from({ length: Math.max(1, nTabs) }, () => { try { return window.open('', '_blank') } catch { return null } })
    try {
      const ids = close ? Array.from(new Set([...chosen.map(l => l.mission_id), ...(openGard ? [openGard.mission_id] : [])])) : chosen.map(l => l.mission_id)
      const r = await fetch(`/api/dossier/${d.root_id}/${close ? 'close-and-invoice' : 'invoice'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_ids: ids, period_to: close ? undefined : periodTo, lines_override: preview ? edited : undefined, quote: quote || undefined }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      ;(j.invoices || []).forEach((inv: any, i: number) => { const t = tabs[i]; if (t && inv.url) { try { t.location.href = inv.url } catch {} } else if (inv.url) { try { window.open(inv.url, '_blank') } catch {} } })
      tabs.slice((j.invoices || []).length).forEach(t => { try { t?.close() } catch {} })
      setResult(j); await onDone(j)
    } catch (e: any) { tabs.forEach(t => { try { t?.close() } catch {} }); setError(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center p-4 pt-12 overflow-auto">
      <div className="w-full max-w-2xl bg-surface border rounded-2xl shadow-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-ink font-bold text-base">Facturer le dossier {d.ref} · {d.vehicle.plate}</h3>
            <p className="text-ink-muted text-xs mt-0.5">Tout coché = facture totale. Décoche ce qui attend = facture partielle. Une facture Odoo par client, créée directement en brouillon, sans devis.</p>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-lg leading-none">✕</button>
        </div>

        {!result && preview && (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">Vérifie les lignes qui partiront dans Odoo. Le prix unitaire accepte une formule, par exemple <span className="font-mono">952/1,21</span>.</p>
            {preview.invoices.map(inv => (
              <div key={inv.client_id} className="border rounded-xl px-3 py-2 space-y-2">
                <div className="flex justify-between text-sm font-semibold text-ink"><span>Facture → {inv.client_name} <span className="text-ink-muted font-normal">· {inv.covers.join(' ')}</span></span>
                  <span className="tabular-nums">{(() => { const t = (inv.sections || []).reduce((s, sec) => s + ((sec.mission_id && edited[sec.mission_id]) || sec.lines).reduce((x, l) => x + Number(l.qty) * Number(l.price_unit), 0), 0); return <>{eur(t)} HTVA <span className="text-ink-muted font-normal text-xs">· {tvac(t)} TVAC</span></> })()}</span></div>
                {(inv.sections || []).map((sec, si) => { const mid = sec.mission_id || ''; const lines = (mid && edited[mid]) || sec.lines; return (
                  <div key={si} className="border-t pt-2">
                    <p className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold mb-1">{sec.section_label}</p>
                    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-ink-muted"><th className="text-left font-medium py-1 w-28">Type</th><th className="text-left font-medium py-1">Désignation</th><th className="text-right font-medium py-1 w-16">Qté</th><th className="text-right font-medium py-1 w-24">PU HTVA</th><th className="text-right font-medium py-1 w-24">Total</th><th className="w-6"></th></tr></thead><tbody>
                      {lines.map((l, i) => (
                        <tr key={i} className="border-t">
                          <td className="py-1 pr-1">{mid ? <select value={l.kind} onChange={e => setLine(mid, i, { kind: e.target.value })} className="border rounded px-1 py-0.5 bg-surface text-ink w-full">{KINDS.map(([k, lb]) => <option key={k} value={k}>{lb}</option>)}</select> : l.kind}</td>
                          <td className="py-1 pr-1">{mid ? <input value={l.name} onChange={e => setLine(mid, i, { name: e.target.value })} className="border rounded px-1.5 py-0.5 bg-surface text-ink w-full" /> : l.name}</td>
                          <td className="py-1 pr-1 text-right">{mid ? <input value={String(l.qty)} onChange={e => setLine(mid, i, { qty: Number(String(e.target.value).replace(',', '.')) || 0 })} className="border rounded px-1 py-0.5 bg-surface text-ink w-full text-right tabular-nums" /> : l.qty}</td>
                          <td className="py-1 pr-1 text-right">{mid ? <input defaultValue={l.price_unit.toFixed(2)} onBlur={e => { const v = evalNum(e.target.value, l.price_unit); e.target.value = v.toFixed(2); setLine(mid, i, { price_unit: v }) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="border rounded px-1 py-0.5 bg-surface text-ink w-full text-right tabular-nums" /> : l.price_unit.toFixed(2)}</td>
                          <td className="py-1 text-right tabular-nums">{(Number(l.qty) * Number(l.price_unit)).toFixed(2)} €</td>
                          <td className="py-1 text-right">{mid && <button onClick={() => delLine(mid, i)} className="text-ink-faint hover:text-red-600" title="Supprimer la ligne">✕</button>}</td>
                        </tr>
                      ))}
                      {!lines.length && <tr><td colSpan={6} className="py-1 text-ink-muted italic">Aucune ligne : section à compléter.</td></tr>}
                    </tbody></table></div>
                    {mid && <button onClick={() => addLine(mid)} className="mt-1 text-[11px] font-semibold text-brand hover:underline">+ Ajouter une ligne</button>}
                  </div>
                ) })}
              </div>
            ))}
            {preview.warnings.length > 0 && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.warn}`}>{preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
            {error && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.bad}`}>{error}</div>}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-1.5">
                <button disabled={busy} onClick={() => { setPreview(null); setCloseMode(false) }} className="px-3 py-1.5 rounded-lg text-xs font-semibold border">← Retour aux groupes</button>
                {(() => { const all = preview.invoices.flatMap(inv => (inv.sections || []).flatMap(sec => (sec.mission_id && edited[sec.mission_id]) || sec.lines)); const ht = all.reduce((s, l) => s + Number(l.qty) * Number(l.price_unit), 0); const ttc = Math.round(ht * 121) / 100
                  return ttc > 0 ? <PushToScreenButton compact amount={ttc} client={d.client.name} plate={d.vehicle.plate} brand={d.vehicle.brand} model={d.vehicle.model} reference={d.ref} lines={all.filter(l => Number(l.qty) * Number(l.price_unit) !== 0).map(l => ({ label: l.name || l.kind, amount: Math.round(Number(l.qty) * Number(l.price_unit) * 121) / 100 }))} /> : null })()}
              </span>
              <span className="flex items-center gap-1.5">
                <button disabled={busy || savingDraft} onClick={saveDrafts} title="Garde ces lignes pour plus tard sans créer la facture" className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">{savingDraft ? '⏳…' : '💾 Sauver en brouillon'}</button>
                {!closeMode && <button disabled={busy} onClick={() => submit(false, true)} title="Un devis Odoo par client, sans rien marquer facturé ; la facture partira du devis dans Odoo ou d'ici plus tard" className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">📄 Devis</button>}
                <button disabled={busy} onClick={closeMode ? askClose : askOrSubmit} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white disabled:opacity-40">{busy ? '⏳ Création…' : closeMode ? '🏁 Clôturer et créer la facture' : `Créer ${preview.invoices.length > 1 ? 'les factures' : 'la facture'}`}</button>
              </span>
            </div>
          </div>
        )}
        {!result && !preview && Array.from(byClient.entries()).map(([client, legs]) => {
          const ch = legs.filter(l => sel.has(l.mission_id)); const sum = ch.reduce((s, l) => s + l.amount_htva, 0)
          return (
            <div key={client} className="border rounded-xl px-3 py-2">
              <div className="flex justify-between text-sm font-semibold text-ink"><span>{ch.length ? 'Facture → ' : <span className="text-ink-muted">Rien pour </span>}{client}{/parquet|justice/i.test(client) && <span className={`ml-2 text-[10.5px] rounded-full px-2 py-0.5 ${TONE.warn}`}>Parquet : passe par l'état de frais, pas par Odoo</span>}</span><span className="tabular-nums text-right">{ch.length ? <>{eur(sum)} HTVA<span className="block text-xs font-normal text-ink-muted">{tvac(sum)} TVAC</span></> : ''}</span></div>
              {legs.map(l => {
                const pick = canPickLeg(l)
                return (
                  <React.Fragment key={l.mission_id}>
                  <button disabled={!pick} onClick={() => toggle(l.mission_id)} className={`w-full grid grid-cols-[22px_1fr_auto] gap-2 items-center py-1 text-left text-xs ${pick ? 'text-ink-secondary' : 'opacity-50 cursor-default'}`}>
                    <span className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center text-[10px] ${sel.has(l.mission_id) ? 'bg-brand border-brand text-white' : 'border-ink-muted'}`}>{sel.has(l.mission_id) ? '✓' : (isLegBilled(l) ? '✓' : l.nothing_to_bill ? '–' : '')}</span>
                    <span><span className="font-mono">{l.letter}</span> {l.title}{l.kind === 'gard' && l.days != null ? ` ${l.days} j` : ''}{l.kind === 'gard' && l.open && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE.live}`}>en cours · arrêté à aujourd'hui si coché</span>}</span>
                    <span className="tabular-nums">{isLegBilled(l) ? `déjà facturé · ${cleanRef(l.billed_refs[0])}` : l.nothing_to_bill ? l.nothing_to_bill : l.channel === 'domaine' ? `${eur(l.amount_htva)} · relevé Domaine` : <>{eur(l.amount_htva)} <span className="text-ink-faint">· {tvac(l.amount_htva)} TVAC</span></>}</span>
                  </button>
                  {(l.alerts || []).length > 0 && (
                    <div className="ml-6 mb-1 space-y-0.5">{(l.alerts || []).map((a, i) => <div key={i} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${/Siabis/.test(a) ? TONE.bad : TONE.warn}`}>⚠ {a}</div>)}</div>
                  )}
                  {l.kind === 'gard' && l.open && sel.has(l.mission_id) && (
                    <div className="ml-6 mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-secondary">
                      <span>Gardiennage facturé jusqu'au</span>
                      <input type="date" value={periodTo[l.mission_id] || today} max={today} min={l.started_at ? String(l.started_at).slice(0, 10) : undefined}
                        onChange={e => setPeriodTo(p => ({ ...p, [l.mission_id]: e.target.value || today }))}
                        className="border rounded px-1.5 py-0.5 bg-surface text-ink text-[11px]" />
                      <span className="text-ink-faint">inclus · le solde continue dans un nouveau groupe dès le lendemain</span>
                    </div>
                  )}
                  </React.Fragment>
                )
              })}
              {legs.some(l => (l.billing_remarks || []).length) && legs.flatMap(l => (l.billing_remarks || []).map((r, i) => (
                <div key={l.letter + i} className="mt-1 bg-slate-800 text-white rounded-lg px-3 py-2 text-xs"><span className="text-slate-300 text-[10.5px]">📝 {d.number}{l.letter}{r.author ? ' · ' + r.author : ''}</span><p className="font-semibold whitespace-pre-line leading-snug">{r.text}</p></div>
              )))}
            </div>
          )
        })}

        {!result && !preview && (
          <>
            {missingClient && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.bad}`}>Un groupe coché n'a pas de client de facturation. Renseigne-le sur le groupe (ligne « Facturer à ») avant de facturer.</div>}
            {runningChosen && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.warn}`}>Un gardiennage en cours est coché : sa période s'arrête à aujourd'hui et un nouveau groupe s'ouvre sur la suite.</div>}
            {!preview && d.state.open && /relivraison/i.test(String(d.state.reason || '')) && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.warn}`}>⚠ Relivraison en cours : la facturer maintenant, c'est facturer avant la livraison.</div>}
            {d.state.open && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.live}`}>Dossier en cours ({d.state.reason}) : facturation manuelle autorisée. L'automatique attendra la sortie du véhicule.</div>}
            {error && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.bad}`}>{error}</div>}
            <div className="flex items-center justify-between gap-3 text-xs flex-wrap">
              <span className="text-ink-muted">{chosen.length ? <><b className="text-ink">{chosen.length === allPickable.length ? 'Facture totale' : 'Facture partielle'}</b> · {nInv} facture{nInv > 1 ? 's' : ''} · {eur(total)} HTVA · <b className="text-ink">{tvac(total)} TVAC</b> · référence « {d.number} {chosen.map(l => l.letter).join(' ')} »</> : 'Rien de coché'}</span>
              <span className="flex items-center gap-1.5">
                <button disabled={busy || !chosen.length} onClick={() => mark('already_billed')} title="Une facture a été faite à la main dans Odoo : donne son numéro, les groupes cochés sont reliés" className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-ink-secondary hover:text-ink disabled:opacity-40">Déjà facturé…</button>
                {/* Visible partout (Olivier 08/09 : « je ne vois pas le bouton ») — la confirmation rappelle le cas d'usage COMEX. */}
                {(
                  <button disabled={busy || !chosen.length} onClick={() => mark('auto_billed')} title="Mission validée par nous dans COMEX : Touring s'autofacture, pas de facture Odoo" className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-surface text-ink-secondary hover:text-ink">⚡ Autofacturé</button>
                )}
                <button disabled={busy || !chosen.length} onClick={() => mark('no_charge')} title="Intervention sans frais pour les groupes cochés (motif demandé)" className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-ink-secondary hover:text-ink disabled:opacity-40">Ne rien facturer</button>
                {canCloseAndBill && (
                  <button disabled={busy || missingClient || !openGard?.billed_to_id} onClick={askClose}
                    title="Le véhicule est enlevé par un transporteur : sortie du parc maintenant, gardiennage arrêté, fiche clôturée, puis toutes les factures du dossier"
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-40">🏁 Clôturer et facturer</button>
                )}
                <button disabled={busy || !chosen.length || missingClient} onClick={askOrSubmit} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white disabled:opacity-40">{busy ? '⏳ Création…' : `Créer ${nInv > 1 ? 'les factures' : 'la facture'}${openGard ? ' et continuer le gardiennage' : ''}`}</button>
              </span>
            </div>
          </>
        )}

        {remarkGate && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4" onClick={() => { if (!busy) setRemarkGate(false) }}>
            <div onClick={e => e.stopPropagation()} className="bg-surface w-full max-w-md rounded-2xl border-2 border-slate-500 p-5 space-y-4">
              <div className="flex items-center gap-2"><span className="text-2xl">📝</span><h3 className="text-ink font-bold text-base">Remarque de facturation</h3></div>
              <p className="text-ink-secondary text-sm">{remarksOfChosen().length > 1 ? 'Ces groupes ont une remarque de facturation. As-tu bien pris en compte :' : 'Ce groupe a une remarque de facturation. As-tu bien pris en compte :'}</p>
              <div className="space-y-2">
                {remarksOfChosen().map((r, i) => (
                  <div key={i} className="bg-slate-800 text-white rounded-lg p-3">
                    <p className="text-slate-300 text-[11px] mb-1"><span className="font-mono">{r.label}</span>{r.author ? <span> · {r.author}</span> : null}</p>
                    <p className="text-white text-sm font-semibold whitespace-pre-line leading-snug">{r.text}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={busy} onClick={() => { setRemarkGate(false); setCloseMode(false) }} className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm">Annuler</button>
                <button type="button" disabled={busy} onClick={() => submit(closeMode)} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold">{busy ? '⏳…' : closeMode ? 'Oui, pris en compte — clôturer et facturer' : 'Oui, pris en compte — facturer'}</button>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2">
            {result.invoices.length > 0
              ? <div className={`rounded-lg px-3 py-2 text-xs ${TONE.ok}`}>✓ {result.invoices.length} facture{result.invoices.length > 1 ? 's' : ''} Odoo créée{result.invoices.length > 1 ? 's' : ''} en brouillon et ouverte{result.invoices.length > 1 ? 's' : ''} dans un nouvel onglet. Les groupes couverts sont reliés ; le numéro définitif arrivera quand la facture sera postée dans Odoo.</div>
              : <div className={`rounded-lg px-3 py-2 text-xs ${TONE.ok}`}>✓ Enregistré.</div>}
            {result.invoices.map((i: any) => (
              <div key={i.odoo_id} className="border rounded-xl px-3 py-2 text-xs flex items-center justify-between gap-3">
                <span><b className="text-ink">{i.client_name}</b> · couvre {i.covers.join(' ')} · {eur(i.total_htva)} HTVA · {tvac(i.total_htva)} TVAC</span>
                <a href={i.url} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg border text-brand font-semibold hover:bg-brand/10">Ouvrir dans Odoo ↗</a>
              </div>
            ))}
            {result.warnings.length > 0 && <div className={`rounded-lg px-3 py-2 text-xs ${TONE.warn}`}>{result.warnings.map((w: string, i: number) => <div key={i}>• {w}</div>)}</div>}
            <div className="flex justify-end"><button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold border">Fermer</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

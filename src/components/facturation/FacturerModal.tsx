'use client'

import { useEffect, useState } from 'react'

interface BaseMission {
  id: string
  external_id: string | null
  dossier_number?: string | null
  source: string | null
  status: string
  mission_type: string | null
  incident_type: string | null
  parent_mission_id: string | null
  client_name: string | null
  client_phone?: string | null
  vehicle_plate: string | null
  vehicle_brand?: string | null
  vehicle_model?: string | null
  vehicle_vin?: string | null
  incident_address?: string | null
  destination_address?: string | null
  received_at: string
  intervention_date?: string | null
  completed_at: string | null
  amount_collected?: number | null
  payment_method?: string | null
  invoice_method: string | null
  invoice_number: string | null
  no_charge_at?:     string | null
  no_charge_reason?: string | null
  odoo_quote_id?:    number | null
  odoo_quote_url?:   string | null
  billed_to_id?:     number | null
  billed_to_name?:   string | null
}

interface PaymentRow {
  id: string
  mission_id: string | null
  amount: number
  payment_mode: string
  client_name: string | null
  created_at: string
  driver_id: string | null
}

interface Props {
  mission:     BaseMission
  siblings:    BaseMission[]               // parent et/ou children
  payments:    PaymentRow[]                // encaissements lies a la mission principale
  driverName:  (id: string | null) => string
  onClose:     () => void
  onUpdated:   (updated: { id: string; status: string; invoice_method?: string | null; invoice_number?: string | null; invoice_url?: string | null }[]) => void
}

interface KmData { total_km: number; segments: Array<{ label: string; km: number | null }>; error?: string | null }

interface SurchargeData {
  surcharges: Array<{
    client_label: string
    weekday_label: string
    hour_start: number
    hour_end: number
    rate_pct: number
    range_label: string
  }>
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function missionKind(m: { mission_type: string | null; incident_type: string | null; parent_mission_id: string | null }): 'REL' | 'REM' | 'DSP' | 'DPR' | 'AUTRE' {
  const it = (m.incident_type || '').toLowerCase()
  const mt = (m.mission_type   || '').toLowerCase()
  if (it === 'relivraison' || m.parent_mission_id) return 'REL'
  if (it === 'dpr')                                 return 'DPR'
  if (mt === 'remorquage')                          return 'REM'
  if (['depannage', 'reparation_place', 'trajet_vide'].includes(mt)) return 'DSP'
  return 'AUTRE'
}

const KIND_COLOR: Record<string, string> = {
  REM: 'bg-amber-500',
  DSP: 'bg-info',
  REL: 'bg-purple-600',
  DPR: 'bg-critical',
  AUTRE: 'bg-ink-faint',
}

const SOURCE_LABEL: Record<string, string> = {
  touring: 'Touring', allianz: 'Allianz', vab: 'VAB',
  axa: 'AXA', ethias: 'Ethias', police: 'Police',
}

// Types d'intervention (= mission_type) — aligne MISSION_TYPES du dispatch.
const MISSION_TYPE_LABELS: Record<string, string> = {
  remorquage:       'Remorquage (REM)',
  depannage:        'Dépannage (DSP)',
  reparation_place: 'Réparation sur place',
  trajet_vide:      'Trajet à vide (DPR)',
  relivraison:      'Relivraison (REL)',
  transport:        'Transport',
  autre:            'Autre',
}
function fmtSource(s: string | null): string {
  if (!s) return '—'
  return SOURCE_LABEL[s.toLowerCase()] || s
}

function Copyable({ value, label, mono }: { value: string; label?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="text-ink-faint">—</span>
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={label ? `Copier ${label}` : 'Copier'}
      className={`group inline-flex items-center gap-1.5 hover:text-brand transition text-left ${mono ? 'font-mono' : ''}`}
    >
      <span>{value}</span>
      <span className={`text-xs ${copied ? 'text-success' : 'text-ink-faint opacity-0 group-hover:opacity-100'} transition`}>
        {copied ? '✓' : '📋'}
      </span>
    </button>
  )
}

interface TemplateLineData {
  kind:             'SERV-PEC' | 'SERV-KM' | 'SERV-PARC' | 'SERV-MAJ' | 'SERV-DIV'
  name:             string
  default_qty:      number | null
  default_price:    number | null
  apply_surcharges: boolean
}

interface PriceEstimateData {
  ok:            boolean
  reason?:       string
  pricing_mode?: 'forfait' | 'brackets' | 'lines'
  forfait:       number | null
  km_extra:      number
  km_extra_eur:  number
  parc_jours:    number
  parc_eur:      number
  surcharge_pct: number
  surcharge_eur: number
  subtotal_eur:  number
  total_eur:     number
  template_lines?: TemplateLineData[]
}

interface QuoteStatusData {
  status:         'not_created' | 'deleted' | 'cancelled' | 'draft' | 'confirmed'
  name?:          string
  url?:           string
  fully_invoiced?: boolean
}

type ProductKind = 'SERV-PEC' | 'SERV-KM' | 'SERV-PARC' | 'SERV-MAJ' | 'SERV-DIV'

interface CustomLine {
  kind:        ProductKind
  name:        string
  qty:         number
  price_unit:  number
}

/**
 * Input numérique qui accepte les formules basiques (ex "952/1,21" → 786.78).
 * Évalue au blur ou à Enter. Les virgules sont converties en points avant eval.
 * Whitelist stricte (chiffres + opérateurs + parens) pour éviter toute injection.
 */
function FormulaInput({
  value, onChange, className,
}: { value: number; onChange: (n: number) => void; className?: string }) {
  const [display, setDisplay] = useState(value.toString().replace('.', ','))

  useEffect(() => {
    setDisplay(value.toString().replace('.', ','))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function evaluate() {
    const expr = display.replace(/,/g, '.').replace(/\s+/g, '').trim()
    if (!expr) { onChange(0); setDisplay('0'); return }
    if (!/^-?[\d.+\-*/()]+$/.test(expr)) {
      // Pas un nombre/formule valide → revert
      setDisplay(value.toString().replace('.', ','))
      return
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const result = Function('"use strict"; return (' + expr + ')')()
      if (typeof result === 'number' && isFinite(result)) {
        const rounded = Math.round(result * 100) / 100
        onChange(rounded)
        setDisplay(rounded.toString().replace('.', ','))
      } else {
        setDisplay(value.toString().replace('.', ','))
      }
    } catch {
      setDisplay(value.toString().replace('.', ','))
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={e => setDisplay(e.target.value)}
      onBlur={evaluate}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder="ex: 952/1,21"
      title="Accepte les formules : 952/1,21 = 786,78"
      className={className}
    />
  )
}

const KIND_LABELS: Record<ProductKind, string> = {
  'SERV-PEC':  'Prise en charge',
  'SERV-KM':   'Kilomètre',
  'SERV-PARC': 'Frais de parc',
  'SERV-MAJ':  'Majoration',
  'SERV-DIV':  'Divers',
}

function MissionBlock({
  m, payments, driverName, busy, onValidate, onAuto, onNoCharge, onQuoteCreated,
}: {
  m:          BaseMission
  payments:   PaymentRow[]
  driverName: (id: string | null) => string
  busy:       boolean
  onValidate: () => void
  onAuto:     () => void
  onNoCharge: () => void
  onQuoteCreated: (missionId: string, quoteId: number, quoteUrl: string) => void
}) {
  const [km, setKm] = useState<KmData | null>(null)
  const [kmLoading, setKmLoading] = useState(true)
  const [surcharges, setSurcharges] = useState<SurchargeData | null>(null)
  const [estimate, setEstimate] = useState<PriceEstimateData | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(true)
  // Olivier 2026-06-01 : avances de fonds liees a cette mission. Affichees
  // dans le UI + ajoutees automatiquement comme lignes SERV-DIV au devis.
  const [linkedAdvances, setLinkedAdvances] = useState<Array<{
    id:             string
    plate:          string
    amount_htva:    number
    invoice_url:    string
    payment_method: string
    created_at:     string
    notes?:         string | null
  }>>([])
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatusData | null>(null)
  const [quoteStatusLoading, setQuoteStatusLoading] = useState(true)
  // Edition manuelle des lignes : null = mode preview/auto, array = lignes editees a pousser
  const [customLines, setCustomLines] = useState<CustomLine[] | null>(null)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const kind = missionKind(m)
  const isReady = m.status === 'to_invoice'

  useEffect(() => {
    let cancelled = false
    setKmLoading(true)
    setEstimateLoading(true)
    fetch(`/api/missions/${m.id}/km`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setKm(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setKmLoading(false) })
    fetch(`/api/missions/${m.id}/surcharges`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSurcharges(d) })
      .catch(() => {})
    // Charge en parallele : estimate auto + draft sauvegarde + avances liees
    Promise.all([
      fetch(`/api/missions/${m.id}/price-estimate`).then(r => r.json()),
      fetch(`/api/missions/${m.id}/invoice-draft`).then(r => r.json()),
      fetch(`/api/advances?mission_id=${m.id}&limit=50`).then(r => r.json()),
    ]).then(([d, draftRes, advRes]: [PriceEstimateData, any, any]) => {
      if (cancelled) return
      setEstimate(d)
      const advances = Array.isArray(advRes?.advances) ? advRes.advances : []
      setLinkedAdvances(advances)
      // Lignes generees pour les avances de fonds liees (1 ligne par avance,
      // SERV-DIV, qty=1, PU=amount_htva). Inserees a la fin des lignes.
      const advanceLines: CustomLine[] = advances.map((a: any) => ({
        kind:       'SERV-DIV' as ProductKind,
        name:       `Avance de fonds — ${a.plate}${a.created_at ? ' du ' + new Date(a.created_at).toLocaleDateString('fr-BE') : ''}`,
        qty:        1,
        price_unit: Number(a.amount_htva) || 0,
      }))

      // 1) Si un brouillon existe en BDD : il prend la priorite
      if (draftRes?.draft?.lines && Array.isArray(draftRes.draft.lines)) {
        setCustomLines(draftRes.draft.lines)
        setHasDraft(true)
        setDraftSavedAt(draftRes.draft.updated_at)
      }
      // 2) Sinon mode 'lines' : init auto depuis le template + avances
      else if (d?.ok && d.pricing_mode === 'lines' && d.template_lines && d.template_lines.length > 0) {
        const initialLines: CustomLine[] = d.template_lines.map(tl => ({
          kind:       tl.kind,
          name:       tl.name,
          qty:        tl.default_qty ?? 0,
          price_unit: tl.default_price ?? 0,
        }))
        if (d.surcharge_pct > 0) {
          initialLines.push({
            kind:       'SERV-MAJ',
            name:       `Majoration ${d.surcharge_pct}%`,
            qty:        Math.round(d.surcharge_pct) / 100,
            price_unit: 0,
          })
        }
        // Avances ajoutees a la fin
        setCustomLines([...initialLines, ...advanceLines])
      }
      // 3) Mode forfait ou autre : si avances presentes, on init quand meme
      else if (advanceLines.length > 0) {
        setCustomLines(advanceLines)
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setEstimateLoading(false) })
    fetch(`/api/missions/${m.id}/quote-status`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setQuoteStatus(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setQuoteStatusLoading(false) })
    return () => { cancelled = true }
  }, [m.id])

  async function refreshQuoteStatus() {
    setQuoteStatusLoading(true)
    try {
      const res = await fetch(`/api/missions/${m.id}/quote-status`)
      const j = await res.json()
      setQuoteStatus(j)
    } finally { setQuoteStatusLoading(false) }
  }

  async function pushQuoteOdoo() {
    setQuoteBusy(true); setQuoteError(null)
    try {
      // Si l employe a personnalise les lignes, on les envoie. Sinon, calcul auto.
      const body = customLines && customLines.length > 0
        ? JSON.stringify({ lines: customLines })
        : undefined
      const res = await fetch(`/api/missions/${m.id}/quote`, {
        method:  'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setQuoteError(j.error || `Erreur ${res.status}`)
        return
      }
      // Ouvre direct le devis Odoo dans nouvel onglet
      if (j.quote?.url) window.open(j.quote.url, '_blank')
      onQuoteCreated(m.id, j.quote.id, j.quote.url)
      // Reset le mode edition (le devis a ete pousse) + cleanup le draft
      setCustomLines(null)
      if (hasDraft) await clearDraft()
      // Recharge le statut pour reflet immediat (status devrait passer en 'draft')
      await refreshQuoteStatus()
    } catch (e: any) {
      setQuoteError(e.message || 'Erreur réseau')
    } finally {
      setQuoteBusy(false)
    }
  }

  /** Initialise customLines a partir de l estimation auto pour edition.
   *  Si l estimation n est pas applicable (pas de tarif), on demarre avec un
   *  tableau vide -> l employe ajoute les lignes manuellement. */
  function startEditingLines() {
    if (!estimate || !estimate.ok) {
      setCustomLines([])  // Tableau vide, edition manuelle
      return
    }
    const lines: CustomLine[] = []
    if (estimate.forfait && estimate.forfait > 0) {
      lines.push({
        kind: 'SERV-PEC',
        name: `Prise en charge — ${m.external_id || m.id.slice(0, 8)}`,
        qty: 1,
        price_unit: estimate.forfait,
      })
    }
    if (estimate.km_extra > 0 && estimate.km_extra_eur > 0) {
      lines.push({
        kind: 'SERV-KM',
        name: `Km supplémentaires`,
        qty: estimate.km_extra,
        price_unit: Math.round((estimate.km_extra_eur / estimate.km_extra) * 100) / 100,
      })
    }
    if (estimate.parc_jours > 0 && estimate.parc_eur > 0) {
      lines.push({
        kind: 'SERV-PARC',
        name: `Frais de parc (${estimate.parc_jours} jour${estimate.parc_jours > 1 ? 's' : ''})`,
        qty: estimate.parc_jours,
        price_unit: Math.round((estimate.parc_eur / estimate.parc_jours) * 100) / 100,
      })
    }
    if (estimate.surcharge_pct > 0 && estimate.surcharge_eur > 0) {
      lines.push({
        kind: 'SERV-MAJ',
        name: `Majoration ${estimate.surcharge_pct}%`,
        qty: Math.round(estimate.surcharge_pct) / 100,
        price_unit: Math.round(estimate.subtotal_eur * 100) / 100,
      })
    }
    setCustomLines(lines)
  }

  function updateLine(idx: number, patch: Partial<CustomLine>) {
    if (!customLines) return
    const next = [...customLines]
    next[idx] = { ...next[idx], ...patch }
    setCustomLines(next)
  }

  function removeLine(idx: number) {
    if (!customLines) return
    setCustomLines(customLines.filter((_, i) => i !== idx))
  }

  function addLine() {
    if (!customLines) return
    setCustomLines([...customLines, { kind: 'SERV-DIV', name: '', qty: 1, price_unit: 0 }])
  }

  const customTotal = customLines ? customLines.reduce((s, l) => s + l.qty * l.price_unit, 0) : 0

  /** Sauvegarde le brouillon en BDD (les customLines courantes). */
  async function saveDraft() {
    if (!customLines) return
    setDraftSaving(true)
    try {
      const res = await fetch(`/api/missions/${m.id}/invoice-draft`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lines: customLines }),
      })
      const j = await res.json()
      if (!res.ok) { alert(`Erreur sauvegarde : ${j.error}`); return }
      setHasDraft(true)
      setDraftSavedAt(j.draft?.updated_at || new Date().toISOString())
    } finally { setDraftSaving(false) }
  }

  /** Supprime le brouillon (apres push reussi ou clic Annuler). */
  async function clearDraft() {
    try {
      await fetch(`/api/missions/${m.id}/invoice-draft`, { method: 'DELETE' })
      setHasDraft(false)
      setDraftSavedAt(null)
    } catch {}
  }

  const totalCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0)

  return (
    <div className={`border rounded-2xl p-4 space-y-3 ${isReady ? 'bg-surface' : 'bg-surface-2 opacity-70'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center justify-center px-2 py-1 rounded-lg text-white text-xs font-bold ${KIND_COLOR[kind]}`}>
            {kind}
          </span>
          <span className="text-ink font-semibold text-sm">
            <Copyable value={m.external_id || m.dossier_number || m.id.slice(0, 8)} label="référence" />
          </span>
        </div>
        {!isReady && (
          <span className="text-xs px-2 py-0.5 rounded bg-ink-faint/15 text-ink-muted" title={m.no_charge_reason || undefined}>
            {m.status === 'completed'
              ? (m.no_charge_at
                  ? `🚫 Annulée${m.no_charge_reason ? ' — ' + m.no_charge_reason : ''}`
                  : m.invoice_method === 'auto'
                    ? 'auto-facturée'
                    : `facturée ${m.invoice_number || ''}`)
              : m.status}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <p className="text-ink-muted text-xs">Date intervention</p>
          <p className="text-ink"><Copyable value={fmtDateTime(m.intervention_date || m.received_at)} label="date intervention" /></p>
          {m.completed_at && (
            <p className="text-ink-faint text-[10px] mt-0.5">Clôturée le {fmtDateTime(m.completed_at)}</p>
          )}
        </div>
        <div>
          <p className="text-ink-muted text-xs">Km calculés</p>
          <p className="text-ink">
            {kmLoading ? <span className="text-ink-faint">⏳…</span>
              : km?.total_km != null ? <Copyable value={`${km.total_km}`} label="km" /> : '—'}
          </p>
        </div>
        {m.incident_address && (
          <div className="sm:col-span-2">
            <p className="text-ink-muted text-xs">Lieu intervention</p>
            <p className="text-ink-secondary text-xs"><Copyable value={m.incident_address} /></p>
          </div>
        )}
        {m.destination_address && (
          <div className="sm:col-span-2">
            <p className="text-ink-muted text-xs">Destination</p>
            <p className="text-ink-secondary text-xs"><Copyable value={m.destination_address} /></p>
          </div>
        )}
      </div>

      {km?.segments && km.segments.length > 0 && (
        <details className="text-xs">
          <summary className="text-ink-muted cursor-pointer">Détail km par segment</summary>
          <ul className="mt-2 space-y-1 pl-3">
            {km.segments.map((s, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-ink-secondary">{s.label}</span>
                <span className={s.km == null ? 'text-ink-faint' : 'text-ink-secondary'}>{s.km != null ? `${s.km} km` : '—'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Majoration tarif applicable (une seule a la fois — plages non-chevauchantes) */}
      {surcharges && surcharges.surcharges.length > 0 && (() => {
        const s = surcharges.surcharges[0]
        return (
          <div className="bg-gradient-to-r from-amber-500/15 to-orange-500/10 border-2 border-amber-500/50 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl">
              ⚠
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-amber-500 text-[10px] font-bold uppercase tracking-widest">Majoration à appliquer</p>
              <p className="text-amber-500 text-2xl font-black leading-tight">+{s.rate_pct}%</p>
              <p className="text-amber-500/80 text-xs mt-0.5 truncate">{s.client_label} · {s.weekday_label} {s.range_label}</p>
            </div>
          </div>
        )
      })()}

      {/* Warning encaissement deja realise — guide l employe facturation pour
          encoder manuellement les paiements dans Odoo apres creation du devis.
          Olivier 2026-06-03 : nouveau process, le chauffeur n encode plus de
          devis Odoo automatiquement. Multi-paiements (cash + Sumup) bien
          mis en evidence pour eviter les oublis. */}
      {payments.length > 0 && (
        <div className={`${payments.length > 1 ? 'bg-amber-50 border-2 border-amber-500' : 'bg-warning-soft border border-warning'} rounded-xl p-3 space-y-1.5`}>
          <p className={`${payments.length > 1 ? 'text-amber-800' : 'text-warning'} text-xs font-semibold flex items-center gap-1`}>
            {payments.length > 1 ? '⚠️ MULTI-PAIEMENTS' : '⚠ ENCAISSEMENT DÉJÀ RÉALISÉ'}
            {payments.length > 1 && <span className="text-amber-700 font-normal">({payments.length} paiements distincts)</span>}
          </p>
          <ul className={`${payments.length > 1 ? 'text-amber-900' : 'text-warning'} text-xs space-y-0.5 list-disc list-inside`}>
            {payments.map(p => (
              <li key={p.id}>
                <strong>{Number(p.amount).toFixed(2)} €</strong> · <span className="uppercase font-semibold">{p.payment_mode}</span> · reçu par {driverName(p.driver_id)} le {fmtDateTime(p.created_at)}
              </li>
            ))}
          </ul>
          {payments.length > 1 && (
            <p className="text-amber-900 text-xs font-bold pt-1 border-t border-amber-400">
              Total reçu : {totalCollected.toFixed(2)} €
            </p>
          )}
          <p className={`${payments.length > 1 ? 'text-amber-900' : 'text-warning'} text-xs italic pt-1 border-t ${payments.length > 1 ? 'border-amber-400' : 'border-warning/30'}`}>
            {payments.length > 1
              ? '→ Crée le devis, puis encode MANUELLEMENT les ' + payments.length + ' paiements dans Odoo (un par mode).'
              : '→ Crée le devis, puis encode le paiement dans Odoo.'}
          </p>
        </div>
      )}

      {/* Section devis Odoo : preview ou edition selon mode */}
      {isReady && (
        <div className="bg-info/5 border border-info/30 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-info text-xs font-semibold uppercase tracking-wide">
              Devis Odoo {customLines ? '— Édition' : ''}
            </p>
            {estimateLoading ? (
              <span className="text-ink-faint text-xs">⏳ calcul…</span>
            ) : customLines ? (
              <span className="text-ink font-bold text-sm">
                Total : {customTotal.toFixed(2).replace('.', ',')} € HTVA · {(customTotal * 1.21).toFixed(2).replace('.', ',')} € TVAC
              </span>
            ) : estimate?.ok ? (
              <span className="text-ink font-bold text-sm">
                Total estimé : {estimate.total_eur.toFixed(2).replace('.', ',')} € HTVA · {(estimate.total_eur * 1.21).toFixed(2).replace('.', ',')} € TVAC
              </span>
            ) : (
              <span className="text-warning text-xs" title={estimate?.reason || ''}>⚠ Tarif introuvable</span>
            )}
          </div>

          {/* Mode preview (lecture seule) */}
          {!customLines && estimate?.ok && (
            <div className="text-[11px] text-ink-secondary space-y-0.5">
              {estimate.forfait != null && estimate.forfait > 0 && (
                <p>• Forfait : {estimate.forfait.toFixed(2).replace('.', ',')} €</p>
              )}
              {estimate.km_extra > 0 && (
                <p>• Km supp ({estimate.km_extra}) : {estimate.km_extra_eur.toFixed(2).replace('.', ',')} €</p>
              )}
              {estimate.parc_jours > 0 && (
                <p>• Parc ({estimate.parc_jours} j) : {estimate.parc_eur.toFixed(2).replace('.', ',')} €</p>
              )}
              {estimate.surcharge_pct > 0 && (
                <p>• Majoration {estimate.surcharge_pct}% : {estimate.surcharge_eur.toFixed(2).replace('.', ',')} €</p>
              )}
              <button
                type="button"
                onClick={startEditingLines}
                className="mt-1 text-info hover:underline font-medium"
              >
                🔧 Modifier les lignes
              </button>
            </div>
          )}

          {/* Pas de tarif : message + bouton pour créer les lignes manuellement OU push shell */}
          {!customLines && !estimateLoading && estimate && !estimate.ok && (
            <div className="text-[11px] text-warning bg-warning/5 border border-warning/20 rounded p-2 space-y-1.5">
              <p>⚠ <strong>Aucune grille tarifaire</strong> pour cette source / type.</p>
              <p>Tu peux soit :</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Cliquer <strong>« Créer les lignes manuellement »</strong> pour saisir les lignes dans l'app avant push</li>
                <li>Cliquer directement <strong>« Créer le devis »</strong> ci-dessous : devis Odoo créé avec client + véhicule + référence pré-remplis, sans lignes (à compléter dans Odoo)</li>
              </ul>
              <button
                type="button"
                onClick={startEditingLines}
                className="text-warning hover:underline font-semibold"
              >
                🔧 Créer les lignes manuellement
              </button>
            </div>
          )}

          {/* Avances de fonds liees a cette mission — Olivier 2026-06-01.
              Chaque avance ajoute automatiquement 1 ligne SERV-DIV au devis
              avec son montant HTVA. Le PDF est cliquable pour verification. */}
          {linkedAdvances.length > 0 && (
            <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-3 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">💰</span>
                <p className="text-indigo-900 text-xs font-bold uppercase tracking-wider">
                  {linkedAdvances.length} avance{linkedAdvances.length > 1 ? 's' : ''} de fonds liée{linkedAdvances.length > 1 ? 's' : ''}
                </p>
              </div>
              <p className="text-indigo-700 text-[11px] mb-2">
                Ajoutée{linkedAdvances.length > 1 ? 's' : ''} automatiquement aux lignes du devis. Vérifie les montants HTVA.
              </p>
              <div className="space-y-1.5">
                {linkedAdvances.map(a => (
                  <div key={a.id} className="flex items-center justify-between gap-2 bg-white border border-indigo-200 rounded-lg px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-indigo-900 text-xs font-semibold truncate">
                        {a.plate} — {Number(a.amount_htva).toFixed(2).replace('.', ',')} € HTVA
                      </p>
                      <p className="text-indigo-700 text-[10px]">
                        {new Date(a.created_at).toLocaleDateString('fr-BE')} · {a.payment_method}
                        {a.notes ? ' · ' + a.notes : ''}
                      </p>
                    </div>
                    {a.invoice_url && (
                      <a href={a.invoice_url} target="_blank" rel="noopener noreferrer"
                        className="flex-shrink-0 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-semibold rounded">
                        📎 PDF
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode edition */}
          {customLines && (
            <div className="space-y-1.5">
              <table className="w-full text-[11px]">
                <thead className="text-ink-faint">
                  <tr>
                    <th className="text-left pb-1">Type</th>
                    <th className="text-left pb-1">Description</th>
                    <th className="text-right pb-1 w-16">Qté</th>
                    <th className="text-right pb-1 w-20">PU €</th>
                    <th className="text-right pb-1 w-20">Total</th>
                    <th className="pb-1 w-6"></th>
                  </tr>
                </thead>
                <tbody className="text-ink">
                  {customLines.map((l, idx) => (
                    <tr key={idx} className="border-t border-info/20">
                      <td className="py-1 pr-1">
                        <select
                          value={l.kind}
                          onChange={e => updateLine(idx, { kind: e.target.value as ProductKind })}
                          className="bg-surface-2 border rounded px-1 py-0.5 text-[10px] w-full"
                        >
                          {(Object.keys(KIND_LABELS) as ProductKind[]).map(k => (
                            <option key={k} value={k}>{KIND_LABELS[k]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-1">
                        <input
                          type="text"
                          value={l.name}
                          onChange={e => updateLine(idx, { name: e.target.value })}
                          className="bg-surface-2 border rounded px-1 py-0.5 text-[11px] w-full"
                        />
                      </td>
                      <td className="py-1 pr-1">
                        <input
                          type="number"
                          step="0.01"
                          value={l.qty}
                          onChange={e => updateLine(idx, { qty: parseFloat(e.target.value) || 0 })}
                          className="bg-surface-2 border rounded px-1 py-0.5 text-[11px] w-full text-right"
                        />
                      </td>
                      <td className="py-1 pr-1">
                        <FormulaInput
                          value={l.price_unit}
                          onChange={n => updateLine(idx, { price_unit: n })}
                          className="bg-surface-2 border rounded px-1 py-0.5 text-[11px] w-full text-right"
                        />
                      </td>
                      <td className="py-1 pr-1 text-right text-ink-secondary">
                        {(l.qty * l.price_unit).toFixed(2).replace('.', ',')}
                      </td>
                      <td className="py-1">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          title="Supprimer cette ligne"
                          className="text-critical hover:text-critical/70"
                        >×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={addLine}
                  className="text-[11px] text-info hover:underline font-medium"
                >
                  + Ajouter une ligne
                </button>
                <div className="flex items-center gap-2">
                  {draftSavedAt && (
                    <span className="text-[10px] text-success">✓ sauvegardé</span>
                  )}
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={draftSaving}
                    className="text-[11px] bg-info hover:bg-info/80 disabled:opacity-50 text-white px-2.5 py-1 rounded font-medium"
                    title="Sauvegarder le brouillon (sera rechargé à la prochaine ouverture)"
                  >
                    {draftSaving ? '⏳…' : '💾 Sauvegarder'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (hasDraft && !confirm('Annuler les modifs et supprimer le brouillon sauvegardé ?')) return
                      setCustomLines(null)
                      if (hasDraft) await clearDraft()
                    }}
                    className="text-[11px] text-ink-faint hover:text-ink"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          )}
          {!m.billed_to_id && (
            <p className="text-warning text-[11px]">⚠ Aucun client à facturer (billed_to_id) — renseigne-le sur la fiche dispatch avant de créer le devis.</p>
          )}
          {quoteError && (
            <p className="text-critical text-[11px]">⚠ {quoteError}</p>
          )}
          <div className="flex gap-2 items-center">
            {quoteStatusLoading ? (
              <span className="text-ink-faint text-xs">⏳ Vérification du devis…</span>
            ) : quoteStatus?.status === 'confirmed' ? (
              <>
                <a
                  href={quoteStatus.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-2 bg-info hover:bg-info/90 text-white rounded-lg text-xs font-semibold text-center transition"
                >
                  📄 Ouvrir le devis Odoo ↗ {quoteStatus.name ? `(${quoteStatus.name})` : ''}
                </a>
                {quoteStatus.fully_invoiced && (
                  <span className="text-[10px] text-success font-semibold">✓ Entièrement facturé</span>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={quoteBusy || !m.billed_to_id}
                  onClick={pushQuoteOdoo}
                  className="flex-1 py-2 bg-info hover:bg-info/90 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
                >
                  {quoteBusy ? '⏳…' : (
                    quoteStatus?.status === 'draft' ? '🔄 Recréer / Mettre à jour le devis' :
                    quoteStatus?.status === 'cancelled' ? '✨ Re-créer le devis (l\'ancien était annulé)' :
                    quoteStatus?.status === 'deleted' ? '✨ Re-créer le devis (l\'ancien a été supprimé)' :
                    '✨ Créer le devis Odoo'
                  )}
                </button>
                {quoteStatus?.status === 'draft' && quoteStatus.url && (
                  <a href={quoteStatus.url} target="_blank" rel="noreferrer"
                    className="px-2.5 py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-xs transition"
                    title="Voir le brouillon en cours">
                    👁
                  </a>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Actions par fiche */}
      {isReady && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onValidate}
              className="flex-1 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
            >
              {busy ? '⏳…' : '✓ Facturation OK'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onAuto}
              className="flex-1 py-2.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink rounded-xl text-sm font-semibold transition"
            >
              {busy ? '⏳…' : '⚡ Autofacturation'}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onNoCharge}
            className="w-full py-2 bg-transparent hover:bg-surface-hover disabled:opacity-50 border border-dashed text-ink-secondary hover:text-ink rounded-xl text-xs font-medium transition"
          >
            🚫 Annuler la mission
          </button>
        </div>
      )}
    </div>
  )
}

export default function FacturerModal({
  mission, siblings, payments, driverName, onClose, onUpdated,
}: Props) {
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [numberPrompt, setNumberPrompt] = useState<{ ids: string[]; label: string } | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [noChargePrompt, setNoChargePrompt] = useState<{ ids: string[]; label: string } | null>(null)
  const [noChargeReason, setNoChargeReason] = useState('')
  // Track des devis créés pendant la session (override les valeurs initiales)
  const [createdQuotes, setCreatedQuotes] = useState<Record<string, { id: number; url: string }>>({})

  // ── Edition inline de la fiche principale (Olivier 2026-06-12) ─────────
  // Permet de rendre une fiche facturable sans quitter la modale : source
  // (grille tarifaire), client facturé (Odoo), véhicule.
  const [m0, setM0]             = useState<BaseMission>(mission)
  const [refreshKey, setRefreshKey] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const [sourcesList, setSourcesList] = useState<Array<{ key: string; label: string }>>([])
  const [edit, setEdit] = useState({
    source:        mission.source || '',
    mission_type:  mission.mission_type || '',
    vehicle_plate: mission.vehicle_plate || '',
    vehicle_brand: mission.vehicle_brand || '',
    vehicle_model: mission.vehicle_model || '',
    vehicle_vin:   mission.vehicle_vin || '',
  })
  const [billedId, setBilledId]     = useState<number | null>(mission.billed_to_id ?? null)
  const [billedName, setBilledName] = useState<string>(mission.billed_to_name || '')
  const [clientQ, setClientQ]       = useState('')
  const [clientResults, setClientResults] = useState<Array<{ id: number; name: string; city?: string; zip?: string }>>([])
  const [clientBusy, setClientBusy] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editMsg, setEditMsg]       = useState<string | null>(null)

  // Bloque le scroll de fond + ferme sur Escape
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Charge la liste des sources (pour le selecteur grille tarifaire)
  useEffect(() => {
    fetch('/api/missions/sources')
      .then(r => r.json())
      .then(d => setSourcesList((d.sources || []).map((s: any) => ({ key: s.key, label: s.label }))))
      .catch(() => {})
  }, [])

  // Recherche client Odoo (debounce) pour le champ "client facturé"
  useEffect(() => {
    if (clientQ.trim().length < 3) { setClientResults([]); return }
    const t = setTimeout(async () => {
      setClientBusy(true)
      try {
        const r = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(clientQ.trim())}`)
        const j = await r.json()
        setClientResults(j.clients || [])
      } catch { /* ignore */ } finally { setClientBusy(false) }
    }, 400)
    return () => clearTimeout(t)
  }, [clientQ])

  async function saveEdit() {
    setSavingEdit(true); setEditMsg(null)
    try {
      const payload: Record<string, any> = {
        source:         edit.source || null,
        mission_type:   edit.mission_type || null,
        vehicle_plate:  edit.vehicle_plate || null,
        vehicle_brand:  edit.vehicle_brand || null,
        vehicle_model:  edit.vehicle_model || null,
        vehicle_vin:    edit.vehicle_vin || null,
        billed_to_id:   billedId,
        billed_to_name: billedName || null,
      }
      const r = await fetch(`/api/missions/${mission.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur enregistrement')
      setM0(prev => ({ ...prev, ...payload }))
      setRefreshKey(k => k + 1)   // force le re-fetch du bloc (tarif/devis)
      setEditMsg('✅ Fiche mise à jour — tarif et client rechargés.')
    } catch (e: any) { setEditMsg('⚠ ' + e.message) } finally { setSavingEdit(false) }
  }

  // Toutes les fiches a afficher (mission principale editee m0 + siblings)
  const all = [m0, ...siblings.filter(s => s.id !== mission.id)]
  // Tri logique : REM avant REL (parent avant enfants)
  all.sort((a, b) => {
    const aIsParent = !a.parent_mission_id
    const bIsParent = !b.parent_mission_id
    if (aIsParent && !bIsParent) return -1
    if (!aIsParent && bIsParent) return 1
    return (a.received_at || '').localeCompare(b.received_at || '')
  })

  const readyIds = all.filter(m => m.status === 'to_invoice').map(m => m.id)
  const totalKmChainHint = ''  // optionnel : on pourrait sommer mais on a deja km par fiche

  async function submit(method: 'manual' | 'auto', ids: string[], number?: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/missions/invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_ids: ids, method, invoice_number: number || undefined }),
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j.error || `Erreur ${res.status}`)
        setBusy(false)
        return
      }
      onUpdated(j.updated || [])
      setNumberPrompt(null)
      setInvoiceNumber('')
      // si plus rien a facturer, on ferme. Sinon on garde le modal ouvert pour
      // continuer (cas chaine REM+REL ou l'employe fait l'un puis l'autre).
      const remaining = all.filter(m => !ids.includes(m.id)).filter(m => m.status === 'to_invoice')
      if (remaining.length === 0) onClose()
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setBusy(false)
    }
  }

  function askNumber(ids: string[], label: string) {
    setNumberPrompt({ ids, label })
    setInvoiceNumber('')
  }

  function confirmNumber() {
    if (!numberPrompt) return
    const n = invoiceNumber.trim()
    if (!n) { setError('Numéro de facture obligatoire'); return }
    submit('manual', numberPrompt.ids, n)
  }

  function askNoCharge(ids: string[], label: string) {
    setNoChargePrompt({ ids, label })
    setNoChargeReason('')
  }

  async function confirmNoCharge() {
    if (!noChargePrompt) return
    const reason = noChargeReason.trim()
    if (reason.length < 4) { setError('Motif requis (min 4 caractères)'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/missions/no-charge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_ids: noChargePrompt.ids, reason }),
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j.error || `Erreur ${res.status}`)
        setBusy(false)
        return
      }
      onUpdated(j.updated || [])
      setNoChargePrompt(null)
      setNoChargeReason('')
      const remaining = all.filter(m => !noChargePrompt.ids.includes(m.id)).filter(m => m.status === 'to_invoice')
      if (remaining.length === 0) onClose()
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface w-full sm:max-w-2xl sm:rounded-2xl sm:my-8 sm:max-h-[90vh] flex flex-col overflow-hidden border border"
      >

        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0 bg-surface">
          <div>
            <p className="text-ink-muted text-xs uppercase tracking-wide">{fmtSource(m0.source)}</p>
            <h2 className="text-ink font-semibold text-base">Facturer — {mission.external_id || mission.dossier_number || mission.id.slice(0,8)}</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-2xl leading-none px-2">✕</button>
        </div>

        {/* Body scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Infos communes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <p className="text-ink-muted text-xs">Client facturé</p>
              <p className="text-ink"><Copyable value={m0.billed_to_name || m0.client_name || '—'} /></p>
            </div>
            {m0.client_phone && (
              <div>
                <p className="text-ink-muted text-xs">Téléphone</p>
                <p className="text-ink"><Copyable value={m0.client_phone} mono /></p>
              </div>
            )}
            <div>
              <p className="text-ink-muted text-xs">Plaque</p>
              <p className="text-ink"><Copyable value={m0.vehicle_plate || '—'} mono /></p>
            </div>
            <div>
              <p className="text-ink-muted text-xs">Véhicule</p>
              <p className="text-ink"><Copyable value={[m0.vehicle_brand, m0.vehicle_model].filter(Boolean).join(' ') || '—'} /></p>
            </div>
            {m0.vehicle_vin && (
              <div className="sm:col-span-2">
                <p className="text-ink-muted text-xs">VIN</p>
                <p className="text-ink"><Copyable value={m0.vehicle_vin} mono /></p>
              </div>
            )}
          </div>

          {/* Edition inline : rendre la fiche facturable sans quitter la modale */}
          <div className="border rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setEditOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-2 hover:bg-surface-hover text-sm font-semibold text-ink transition"
            >
              <span>✏️ Modifier la fiche (source, client facturé, véhicule)</span>
              <span className="text-ink-muted">{editOpen ? '▲' : '▼'}</span>
            </button>
            {editOpen && (
              <div className="p-4 space-y-3 bg-surface">
                {/* Source + type d'intervention (déterminent la grille tarifaire) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">Source</label>
                    <select
                      value={edit.source}
                      onChange={e => setEdit(s => ({ ...s, source: e.target.value }))}
                      className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
                    >
                      <option value="">— Choisir une source —</option>
                      {sourcesList.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">Type d&apos;intervention</label>
                    <select
                      value={edit.mission_type}
                      onChange={e => setEdit(s => ({ ...s, mission_type: e.target.value }))}
                      className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
                    >
                      <option value="">— Choisir un type —</option>
                      {Object.entries(MISSION_TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-ink-faint text-[11px]">Source + type déterminent la grille tarifaire appliquée.</p>

                {/* Client facturé (Odoo) */}
                <div>
                  <label className="block text-ink-muted text-xs mb-1">
                    Client facturé {billedId ? <span className="text-success">· lié (#{billedId})</span> : <span className="text-warning">· non lié</span>}
                  </label>
                  {billedName && (
                    <div className="flex items-center gap-2 mb-1.5 text-sm text-ink">
                      <span className="font-medium">{billedName}</span>
                      <button type="button" onClick={() => { setBilledId(null); setBilledName(''); }}
                        className="text-xs text-critical underline">retirer</button>
                    </div>
                  )}
                  <input
                    value={clientQ}
                    onChange={e => setClientQ(e.target.value)}
                    placeholder="Rechercher un client Odoo (nom, tél, réf)…"
                    className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
                  />
                  {clientBusy && <p className="text-ink-muted text-xs mt-1">Recherche…</p>}
                  {clientResults.length > 0 && (
                    <div className="mt-1 border rounded-xl divide-y max-h-44 overflow-y-auto">
                      {clientResults.map(c => (
                        <button key={c.id} type="button"
                          onClick={() => { setBilledId(c.id); setBilledName(c.name); setClientQ(''); setClientResults([]) }}
                          className="w-full text-left px-3 py-2 hover:bg-surface-hover text-sm">
                          <span className="text-ink font-medium">{c.name}</span>
                          {(c.zip || c.city) && <span className="text-ink-muted text-xs"> · {[c.zip, c.city].filter(Boolean).join(' ')}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Véhicule */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">Plaque</label>
                    <input value={edit.vehicle_plate} onChange={e => setEdit(s => ({ ...s, vehicle_plate: e.target.value.toUpperCase() }))}
                      className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">VIN</label>
                    <input value={edit.vehicle_vin} onChange={e => setEdit(s => ({ ...s, vehicle_vin: e.target.value.toUpperCase() }))}
                      className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">Marque</label>
                    <input value={edit.vehicle_brand} onChange={e => setEdit(s => ({ ...s, vehicle_brand: e.target.value }))}
                      className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">Modèle</label>
                    <input value={edit.vehicle_model} onChange={e => setEdit(s => ({ ...s, vehicle_model: e.target.value }))}
                      className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand" />
                  </div>
                </div>

                {editMsg && <p className={`text-xs ${editMsg.startsWith('✅') ? 'text-success' : 'text-critical'}`}>{editMsg}</p>}

                <div className="flex items-center gap-2">
                  <button type="button" onClick={saveEdit} disabled={savingEdit}
                    className="flex-1 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
                    {savingEdit ? '⏳ Enregistrement…' : '💾 Enregistrer'}
                  </button>
                  <a href={`/dispatch/${mission.id}`} target="_blank" rel="noopener noreferrer"
                    className="px-3 py-2.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-xl text-xs font-semibold transition whitespace-nowrap"
                    title="Éditeur complet (adresses, montants, dérogations…)">
                    Éditeur complet ↗
                  </a>
                </div>
                <p className="text-ink-faint text-[11px]">
                  Après enregistrement, le tarif et le statut du devis sont rechargés automatiquement.
                </p>
              </div>
            )}
          </div>

          {/* Blocks par fiche */}
          <div className="space-y-3">
            {all.map(m => {
              const overrideQuote = createdQuotes[m.id]
              const mWithQuote: BaseMission = overrideQuote
                ? { ...m, odoo_quote_id: overrideQuote.id, odoo_quote_url: overrideQuote.url }
                : m
              return (
                <MissionBlock
                  key={`${m.id}-${m.id === mission.id ? refreshKey : 0}`}
                  m={mWithQuote}
                  payments={m.id === mission.id ? payments : []}
                  driverName={driverName}
                  busy={busy}
                  onValidate={() => askNumber([m.id], m.external_id || m.id.slice(0,8))}
                  onAuto={() => submit('auto', [m.id])}
                  onNoCharge={() => askNoCharge([m.id], m.external_id || m.id.slice(0,8))}
                  onQuoteCreated={(missionId, quoteId, quoteUrl) => {
                    setCreatedQuotes(prev => ({ ...prev, [missionId]: { id: quoteId, url: quoteUrl } }))
                  }}
                />
              )
            })}
          </div>

          {/* Actions chaine */}
          {readyIds.length >= 2 && (
            <div className="bg-purple-600/10 border border-purple-600/30 rounded-2xl p-4 space-y-2">
              <p className="text-ink-muted text-xs uppercase tracking-wide">Actions chaîne ({readyIds.length} fiches)</p>
              <p className="text-ink-secondary text-xs">
                Touring (et compagnies similaires) facturent souvent REM + REL ensemble avec 1 seul numéro.
              </p>

              {/* Bouton creer un devis groupe Odoo (1 sale.order avec sections) */}
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true); setError(null)
                  try {
                    const res = await fetch('/api/missions/quote-grouped', {
                      method:  'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body:    JSON.stringify({ mission_ids: readyIds }),
                    })
                    const j = await res.json()
                    if (!res.ok || !j.ok) {
                      setError(j.error || `Erreur ${res.status}`)
                      return
                    }
                    if (j.quote?.url) window.open(j.quote.url, '_blank')
                    // Recharge la page pour rafraichir les states quote-status
                    // des MissionBlock (qui ont leur fetch propre au mount).
                    window.location.reload()
                  } catch (e: any) {
                    setError(e.message || 'Erreur réseau')
                  } finally {
                    setBusy(false)
                  }
                }}
                className="w-full py-2.5 bg-info hover:bg-info/90 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
              >
                {busy ? '⏳…' : `✨ Créer un devis groupé Odoo (${readyIds.length} sections)`}
              </button>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => askNumber(readyIds, 'chaîne complète')}
                  className="flex-1 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
                >
                  ✓ Tout facturer OK (1 n°)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submit('auto', readyIds)}
                  className="flex-1 py-2.5 bg-surface hover:bg-surface-hover disabled:opacity-50 border text-ink rounded-xl text-sm font-semibold transition"
                >
                  ⚡ Tout autofacturer
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => askNoCharge(readyIds, 'chaîne complète')}
                className="w-full py-2 bg-transparent hover:bg-surface-hover disabled:opacity-50 border border-dashed text-ink-secondary hover:text-ink rounded-xl text-xs font-medium transition"
              >
                🚫 Annuler toute la chaîne
              </button>
            </div>
          )}

          {error && (
            <div className="bg-critical-soft border border-critical rounded-xl p-3">
              <p className="text-critical text-sm">⚠ {error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Sub-modal : motif intervention sans frais */}
      {noChargePrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4"
             onClick={() => { if (!busy) setNoChargePrompt(null) }}>
          <div onClick={e => e.stopPropagation()}
               className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4">
            <div>
              <h3 className="text-ink font-semibold text-base">🚫 Annuler la mission</h3>
              <p className="text-ink-muted text-xs mt-1">Pour {noChargePrompt.label}</p>
              <p className="text-ink-secondary text-xs mt-2">Motif obligatoire (min 4 caractères) — ex: geste commercial, dossier en litige, etc.</p>
            </div>
            <textarea
              autoFocus
              value={noChargeReason}
              onChange={e => setNoChargeReason(e.target.value)}
              placeholder="Motif libre…"
              rows={3}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint resize-none"
            />
            <p className="text-ink-faint text-[10px]">
              {noChargeReason.trim().length}/4 caractères minimum
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setNoChargePrompt(null)}
                className="flex-1 py-2.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink-secondary rounded-xl text-sm transition"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy || noChargeReason.trim().length < 4}
                onClick={confirmNoCharge}
                className="flex-1 py-2.5 bg-warning hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
              >
                {busy ? '⏳…' : 'Confirmer l\'annulation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal : saisie numero facture */}
      {numberPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4"
             onClick={() => { if (!busy) setNumberPrompt(null) }}>
          <div onClick={e => e.stopPropagation()}
               className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4">
            <div>
              <h3 className="text-ink font-semibold text-base">Numéro de facture Odoo</h3>
              <p className="text-ink-muted text-xs mt-1">Pour {numberPrompt.label}</p>
            </div>
            <input
              autoFocus
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmNumber() }}
              placeholder="ex: INV/2026/00123"
              className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint font-mono"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setNumberPrompt(null)}
                className="flex-1 py-2.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink-secondary rounded-xl text-sm transition"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy || !invoiceNumber.trim()}
                onClick={confirmNumber}
                className="flex-1 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
              >
                {busy ? '⏳…' : 'Valider'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

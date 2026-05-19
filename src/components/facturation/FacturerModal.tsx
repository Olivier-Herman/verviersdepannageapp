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

interface PriceEstimateData {
  ok:            boolean
  reason?:       string
  forfait:       number | null
  km_extra:      number
  km_extra_eur:  number
  parc_jours:    number
  parc_eur:      number
  surcharge_pct: number
  surcharge_eur: number
  subtotal_eur:  number
  total_eur:     number
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
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
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
    fetch(`/api/missions/${m.id}/price-estimate`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setEstimate(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setEstimateLoading(false) })
    return () => { cancelled = true }
  }, [m.id])

  async function pushQuoteOdoo() {
    setQuoteBusy(true); setQuoteError(null)
    try {
      const res = await fetch(`/api/missions/${m.id}/quote`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setQuoteError(j.error || `Erreur ${res.status}`)
        return
      }
      // Ouvre direct le devis Odoo dans nouvel onglet
      if (j.quote?.url) window.open(j.quote.url, '_blank')
      onQuoteCreated(m.id, j.quote.id, j.quote.url)
    } catch (e: any) {
      setQuoteError(e.message || 'Erreur réseau')
    } finally {
      setQuoteBusy(false)
    }
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
                  ? `🚫 sans frais${m.no_charge_reason ? ' — ' + m.no_charge_reason : ''}`
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

      {/* Warning encaissement deja realise */}
      {payments.length > 0 && (
        <div className="bg-warning-soft border border-warning rounded-xl p-3 space-y-1.5">
          <p className="text-warning text-xs font-semibold">⚠ ENCAISSEMENT DÉJÀ RÉALISÉ</p>
          {payments.map(p => (
            <p key={p.id} className="text-warning text-xs">
              {Number(p.amount).toFixed(2)} € {p.payment_mode} reçu par {driverName(p.driver_id)} le {fmtDateTime(p.created_at)}
            </p>
          ))}
          {payments.length > 1 && (
            <p className="text-warning text-xs font-bold pt-1 border-t border-warning/30">
              Total : {totalCollected.toFixed(2)} €
            </p>
          )}
          <p className="text-warning text-xs italic">→ Facture à émettre comme acompte / soldée</p>
        </div>
      )}

      {/* Section devis Odoo : preview montant + bouton creer/ouvrir */}
      {isReady && (
        <div className="bg-info/5 border border-info/30 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-info text-xs font-semibold uppercase tracking-wide">Devis Odoo</p>
            {estimateLoading ? (
              <span className="text-ink-faint text-xs">⏳ calcul…</span>
            ) : estimate?.ok ? (
              <span className="text-ink font-bold text-sm">
                Total estimé : {estimate.total_eur.toFixed(2).replace('.', ',')} €
              </span>
            ) : (
              <span className="text-warning text-xs" title={estimate?.reason || ''}>⚠ Tarif introuvable</span>
            )}
          </div>
          {estimate?.ok && (
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
            </div>
          )}
          {!m.billed_to_id && (
            <p className="text-warning text-[11px]">⚠ Aucun client à facturer (billed_to_id) — renseigne-le sur la fiche dispatch avant de créer le devis.</p>
          )}
          {quoteError && (
            <p className="text-critical text-[11px]">⚠ {quoteError}</p>
          )}
          <div className="flex gap-2">
            {m.odoo_quote_id && m.odoo_quote_url ? (
              <>
                <a
                  href={m.odoo_quote_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-2 bg-info hover:bg-info/90 text-white rounded-lg text-xs font-semibold text-center transition"
                >
                  📄 Ouvrir le devis Odoo ↗
                </a>
                <button
                  type="button"
                  disabled={quoteBusy || !m.billed_to_id || !estimate?.ok}
                  onClick={pushQuoteOdoo}
                  className="px-3 py-2 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 border text-ink-secondary hover:text-ink rounded-lg text-xs font-medium transition"
                  title="Recalculer + mettre à jour les lignes du devis Odoo"
                >
                  {quoteBusy ? '⏳…' : '🔄 Mettre à jour'}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={quoteBusy || !m.billed_to_id || !estimate?.ok}
                onClick={pushQuoteOdoo}
                className="flex-1 py-2 bg-info hover:bg-info/90 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
              >
                {quoteBusy ? '⏳ Création…' : '✨ Créer le devis Odoo'}
              </button>
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
            🚫 Intervention sans frais
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

  // Toutes les fiches a afficher (mission principale + siblings, dédupliquées)
  const all = [mission, ...siblings.filter(s => s.id !== mission.id)]
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
            <p className="text-ink-muted text-xs uppercase tracking-wide">{fmtSource(mission.source)}</p>
            <h2 className="text-ink font-semibold text-base">Facturer — {mission.external_id || mission.dossier_number || mission.id.slice(0,8)}</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-2xl leading-none px-2">✕</button>
        </div>

        {/* Body scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Infos communes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <p className="text-ink-muted text-xs">Client</p>
              <p className="text-ink"><Copyable value={mission.client_name || '—'} /></p>
            </div>
            {mission.client_phone && (
              <div>
                <p className="text-ink-muted text-xs">Téléphone</p>
                <p className="text-ink"><Copyable value={mission.client_phone} mono /></p>
              </div>
            )}
            <div>
              <p className="text-ink-muted text-xs">Plaque</p>
              <p className="text-ink"><Copyable value={mission.vehicle_plate || '—'} mono /></p>
            </div>
            <div>
              <p className="text-ink-muted text-xs">Véhicule</p>
              <p className="text-ink"><Copyable value={[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ') || '—'} /></p>
            </div>
            {mission.vehicle_vin && (
              <div className="sm:col-span-2">
                <p className="text-ink-muted text-xs">VIN</p>
                <p className="text-ink"><Copyable value={mission.vehicle_vin} mono /></p>
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
                  key={m.id}
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
                🚫 Toute la chaîne sans frais
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
              <h3 className="text-ink font-semibold text-base">🚫 Intervention sans frais</h3>
              <p className="text-ink-muted text-xs mt-1">Pour {noChargePrompt.label}</p>
              <p className="text-ink-secondary text-xs mt-2">Motif obligatoire (min 4 caractères) — ex: Momo, geste commercial, ami, etc.</p>
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
                {busy ? '⏳…' : 'Valider sans frais'}
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

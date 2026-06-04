'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  X, Search, UserPlus, AlertTriangle, ShieldAlert, Check, Loader2,
  Banknote, CreditCard, Truck, Trash2, Plus, ScrollText,
} from 'lucide-react'

// Tarification commune fourriere (constantes synchro avec /api/missions/[id]/restitute)
const GARDIENNAGE_PRICE_HTVA = 20
const TVA_RATE               = 0.21

// Configuration par source (alignee avec SOURCE_CONFIGS du backend)
interface SourceConfig {
  label:              string
  forfaitHtva:        number
  forfaitLabel:       string
  minDays:            number
  requiresLeveeSaisie: boolean
}
const SOURCE_CONFIGS: Record<string, SourceConfig> = {
  police_mg: {
    label:              'Mal Garée',
    forfaitHtva:        165.29,
    forfaitLabel:       'Forfait enlèvement Mal Garée',
    minDays:            0,
    requiresLeveeSaisie: false,
  },
  police_rodeo: {
    label:              'Rodéo',
    forfaitHtva:        165.29,
    forfaitLabel:       'Forfait enlèvement Rodéo',
    minDays:            3,
    requiresLeveeSaisie: true,
  },
  // Olivier 2026-06-04 : extensions pour permettre la restitution avec paiement
  // sur d autres sources Police. Tarifs alignes sur SOURCE_CONFIGS backend a
  // verifier si besoin (fallback Mal Garee si non specifies cote API).
  police_accident: {
    label:              'Police Accident',
    forfaitHtva:        165.29,
    forfaitLabel:       'Forfait remorquage Accident',
    minDays:            0,
    requiresLeveeSaisie: false,
  },
  police_saisie: {
    label:              'Saisie',
    forfaitHtva:        165.29,
    forfaitLabel:       'Forfait remorquage Saisie',
    minDays:            0,
    requiresLeveeSaisie: true,
  },
  police_avp: {
    label:              'AVP',
    forfaitHtva:        165.29,
    forfaitLabel:       'Forfait remorquage AVP',
    minDays:            0,
    requiresLeveeSaisie: false,
  },
  sia_couvert: {
    label:              'SIA couvert',
    forfaitHtva:        165.29,
    forfaitLabel:       'Forfait remorquage SIA',
    minDays:            0,
    requiresLeveeSaisie: false,
  },
}

interface Mission {
  id:                     string
  source:                 string             // 'police_mg' | 'police_rodeo' | ...
  external_id:            string | null
  dossier_number:         string | null
  vehicle_plate:          string | null
  vehicle_brand:          string | null
  vehicle_model:          string | null
  client_name:            string | null
  client_phone:           string | null
  billed_to_id:           number | null
  billed_to_name:         string | null
  parked_at:              string | null
  received_at:            string | null
  intervention_date:      string | null
  police_blocked:         boolean
  police_levee_saisie_ok: boolean
}

interface OdooPartner {
  id:     number
  name:   string
  phone?: string | null
  street?: string | null
  city?:  string | null
  zip?:   string | null
  email?: string | null
}

type PaymentMode = 'cash' | 'bancontact' | 'driver_encaissement'

interface PaymentRow {
  mode:   PaymentMode
  amount: string  // string for input control, converted to number on submit
}

interface Props {
  mission:           Mission
  userHasOdooAccess: boolean
  onClose:           () => void
  onSuccess:         (result: { mode: string; redirect_to?: string; quote?: { id: number; url: string } }) => void
}

function computeDays(entryIso: string | null, nowDate: Date): number {
  if (!entryIso) return 0
  const t = new Date(entryIso).getTime()
  if (!isFinite(t)) return 0
  return Math.floor((nowDate.getTime() - t) / (24 * 60 * 60 * 1000))
}

export default function RestituerMalGareeModal({ mission, userHasOdooAccess, onClose, onSuccess }: Props) {
  // Lookup config selon source ; fallback Mal Garee si inconnue
  const sourceConfig: SourceConfig = SOURCE_CONFIGS[mission.source] || SOURCE_CONFIGS.police_mg

  // Levee de saisie : requise pour les Rodeos.
  // Si deja cochee a la creation (police_levee_saisie_ok=true), on skip l etape verif.
  const needsLeveeSaisieCheck = sourceConfig.requiresLeveeSaisie && !mission.police_levee_saisie_ok

  // ──────────── Etat machine ────────────
  // Step 1 : verif blocage police OU levee de saisie (selon source)
  // Step 2 : choix partner (recherche / création)
  // Step 3 : paiements et validation
  const initialStep: 1 | 2 = (mission.police_blocked || needsLeveeSaisieCheck) ? 1 : 2
  const [step, setStep]               = useState<1 | 2 | 3>(initialStep)
  const [policeVerified, setPoliceVerified] = useState(false)
  const [leveeSaisieVerified, setLeveeSaisieVerified] = useState(false)

  // Partner Odoo
  const [partnerQuery, setPartnerQuery]   = useState('')
  const [partnerResults, setPartnerResults] = useState<OdooPartner[]>([])
  const [partnerLoading, setPartnerLoading] = useState(false)
  const [selectedPartner, setSelectedPartner] = useState<OdooPartner | null>(null)
  const [showCreate, setShowCreate]       = useState(false)

  // Nouveau partner
  const [newPartnerName,   setNewPartnerName]   = useState('')
  const [newPartnerEmail,  setNewPartnerEmail]  = useState('')
  const [newPartnerPhone,  setNewPartnerPhone]  = useState('')
  const [newPartnerAddress, setNewPartnerAddress] = useState('')  // 1 champ Google adress combiné
  const [newPartnerStreet, setNewPartnerStreet] = useState('')
  const [newPartnerZip,    setNewPartnerZip]    = useState('')
  const [newPartnerCity,   setNewPartnerCity]   = useState('')
  const [creatingPartner,  setCreatingPartner]  = useState(false)

  // Paiements
  const [payments, setPayments] = useState<PaymentRow[]>([{ mode: 'cash', amount: '' }])

  // No charge
  const [noChargeMode, setNoChargeMode] = useState(false)
  const [noChargeReason, setNoChargeReason] = useState('')

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  // Tarification live (applique minDays selon source)
  const rawDays    = useMemo(() => computeDays(mission.parked_at || mission.received_at, new Date()), [mission])
  const days       = Math.max(rawDays, sourceConfig.minDays)
  const minApplied = days > rawDays  // affichage : "minimum N jours applique"
  const forfait    = sourceConfig.forfaitHtva
  const gardien    = GARDIENNAGE_PRICE_HTVA * days
  const totalHtva  = forfait + gardien
  const totalTvac  = Math.round(totalHtva * (1 + TVA_RATE) * 100) / 100

  // ──────────── Recherche Partner Odoo (debounce) ────────────
  useEffect(() => {
    if (showCreate) return
    if (partnerQuery.trim().length < 3) {
      setPartnerResults([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setPartnerLoading(true)
      try {
        const res = await fetch(`/api/odoo/search-client?q=${encodeURIComponent(partnerQuery.trim())}`, { signal: ctrl.signal })
        const j = await res.json()
        if (res.ok) setPartnerResults(j.clients || [])
      } catch {}
      finally { setPartnerLoading(false) }
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [partnerQuery, showCreate])

  // ──────────── Pre-remplir nom client depuis mission ────────────
  useEffect(() => {
    if (mission.client_name && !partnerQuery && !selectedPartner) {
      setPartnerQuery(mission.client_name)
    }
  }, [mission.client_name])

  // ──────────── Actions paiements ────────────
  function addPayment() {
    // mode par defaut : bancontact si premier est cash, sinon cash
    const nextMode: PaymentMode = payments.length === 0 ? 'cash'
      : payments[0].mode === 'cash' ? 'bancontact'
      : 'cash'
    setPayments(prev => [...prev, { mode: nextMode, amount: '' }])
  }
  function removePayment(idx: number) {
    setPayments(prev => prev.filter((_, i) => i !== idx))
  }
  function updatePayment(idx: number, patch: Partial<PaymentRow>) {
    setPayments(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p))
  }
  function autoFillRemaining(idx: number) {
    const others = payments.reduce((s, p, i) => i === idx ? s : s + (parseFloat(p.amount) || 0), 0)
    const remaining = Math.max(0, Math.round((totalTvac - others) * 100) / 100)
    updatePayment(idx, { amount: remaining.toFixed(2) })
  }

  const sumPayments = useMemo(
    () => payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0),
    [payments],
  )
  const remaining = Math.round((totalTvac - sumPayments) * 100) / 100
  const paymentsValid = Math.abs(sumPayments - totalTvac) <= 0.01

  // ──────────── Create partner Odoo ────────────
  async function handleCreatePartner() {
    if (!newPartnerName.trim()) { setErr('Nom requis'); return }
    setCreatingPartner(true)
    setErr(null)
    try {
      const res = await fetch('/api/odoo/create-client', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:   newPartnerName.trim(),
          phone:  newPartnerPhone.trim() || undefined,
          street: newPartnerStreet.trim() || newPartnerAddress.trim() || undefined,
          city:   newPartnerCity.trim() || undefined,
          zip:    newPartnerZip.trim() || undefined,
          email:  newPartnerEmail.trim() || undefined,
          is_company: false,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur creation partner')
      setSelectedPartner(j.partner)
      setShowCreate(false)
      setPartnerQuery(j.partner.name)
      setStep(3)
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setCreatingPartner(false)
    }
  }

  // ──────────── Submit final ────────────
  async function handleSubmit() {
    if (mission.police_blocked && !policeVerified) {
      setErr('Vérification police requise')
      return
    }
    if (needsLeveeSaisieCheck && !leveeSaisieVerified) {
      setErr('Confirmation de la levée de saisie requise')
      return
    }

    // Mode no_charge
    if (noChargeMode) {
      if (!noChargeReason.trim()) { setErr('Motif obligatoire pour Restitution sans frais'); return }
      setSubmitting(true)
      setErr(null)
      try {
        const res = await fetch(`/api/missions/${mission.id}/restitute`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            mode: 'no_charge',
            no_charge_reason: noChargeReason.trim(),
            police_verified: policeVerified,
            levee_saisie_verified: leveeSaisieVerified,
          }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || 'Erreur')
        onSuccess({ mode: 'no_charge' })
      } catch (e: any) {
        setErr(e.message || 'Erreur')
      } finally {
        setSubmitting(false)
      }
      return
    }

    // Mode invoice ou driver_cash : partner + payments requis
    if (!selectedPartner) { setErr('Sélectionne un client Odoo'); return }
    if (!paymentsValid) { setErr(`Total paiements ${sumPayments.toFixed(2)} € != total dû ${totalTvac.toFixed(2)} €`); return }

    const mode = userHasOdooAccess ? 'invoice' : 'driver_cash'
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch(`/api/missions/${mission.id}/restitute`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode,
          partner_id:      selectedPartner.id,
          partner_name:    selectedPartner.name,
          payments:        payments.map(p => ({ mode: p.mode, amount: parseFloat(p.amount) || 0 })),
          police_verified: policeVerified,
          levee_saisie_verified: leveeSaisieVerified,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      onSuccess({ mode, redirect_to: j.redirect_to, quote: j.quote })
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setSubmitting(false)
    }
  }

  // ──────────── Render ────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h2 className="text-ink font-bold">Restituer le véhicule — {sourceConfig.label}</h2>
            <p className="text-ink-muted text-xs mt-0.5">
              {mission.vehicle_plate} {mission.vehicle_brand} {mission.vehicle_model} · {days} jour{days !== 1 ? 's' : ''} de gardiennage{minApplied ? ` (min ${sourceConfig.minDays}j)` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-hover rounded-lg text-ink-muted hover:text-ink transition">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Bandeau alerte police bloquee */}
          {mission.police_blocked && step === 1 && (
            <div className="bg-warning/10 border border-warning/40 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="text-warning flex-shrink-0 mt-0.5" size={20} />
                <div className="flex-1">
                  <h3 className="text-ink font-semibold">🚓 Mission bloquée par la police</h3>
                  <p className="text-ink-secondary text-sm mt-1">
                    Le policier a exigé que le propriétaire passe au commissariat avant la restitution.
                  </p>
                  <label className="flex items-start gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={policeVerified}
                      onChange={e => setPoliceVerified(e.target.checked)}
                      className="mt-1 w-5 h-5"
                    />
                    <span className="text-ink text-sm font-medium">
                      Je confirme que le propriétaire s&apos;est bien présenté à la police
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Bandeau alerte levee de saisie obligatoire (Rodeo) */}
          {needsLeveeSaisieCheck && step === 1 && (
            <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <ScrollText className="text-rose-500 flex-shrink-0 mt-0.5" size={20} />
                <div className="flex-1">
                  <h3 className="text-ink font-semibold">📋 Levée de saisie obligatoire</h3>
                  <p className="text-ink-secondary text-sm mt-1">
                    Mission Rodéo : la levée de saisie n&apos;a pas été cochée à la création. Confirme que tu as reçu le document de la police avant de continuer.
                  </p>
                  <label className="flex items-start gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={leveeSaisieVerified}
                      onChange={e => setLeveeSaisieVerified(e.target.checked)}
                      className="mt-1 w-5 h-5"
                    />
                    <span className="text-ink text-sm font-medium">
                      Je confirme avoir reçu la levée de saisie de la police
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Bouton "Continuer" si etape 1 (un OU plusieurs blocages a valider) */}
          {step === 1 && (mission.police_blocked || needsLeveeSaisieCheck) && (
            <button
              onClick={() => setStep(2)}
              disabled={
                (mission.police_blocked && !policeVerified) ||
                (needsLeveeSaisieCheck && !leveeSaisieVerified)
              }
              className="w-full px-4 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition">
              Continuer →
            </button>
          )}

          {/* Step 2/3 — bandeau résumé véhicule */}
          {step >= 2 && (
            <>
              {/* Choix mode : facturation OU sans frais */}
              <div className="flex gap-2">
                <button
                  onClick={() => setNoChargeMode(false)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition ${
                    !noChargeMode
                      ? 'bg-brand/15 border-brand text-brand'
                      : 'bg-surface-2 border-ink/15 text-ink-secondary hover:text-ink'
                  }`}>
                  💰 Restituer + Facturer
                </button>
                <button
                  onClick={() => setNoChargeMode(true)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition ${
                    noChargeMode
                      ? 'bg-warning/15 border-warning text-warning'
                      : 'bg-surface-2 border-ink/15 text-ink-secondary hover:text-ink'
                  }`}>
                  🎁 Sans frais
                </button>
              </div>

              {/* No charge : motif */}
              {noChargeMode && (
                <div className="bg-warning/5 border border-warning/30 rounded-xl p-4 space-y-2">
                  <label className="text-ink text-sm font-medium">Motif (obligatoire)</label>
                  <textarea
                    value={noChargeReason}
                    onChange={e => setNoChargeReason(e.target.value)}
                    placeholder="Ex: véhicule restitué dans le cadre d'un échange commercial..."
                    rows={3}
                    className="w-full px-3 py-2 bg-surface border rounded-lg text-ink text-sm focus:outline-none focus:border-warning"
                  />
                </div>
              )}

              {!noChargeMode && (
                <>
                  {/* Partner Odoo */}
                  <div className="space-y-2">
                    <label className="text-ink text-sm font-medium">Client (Partner Odoo)</label>
                    {selectedPartner ? (
                      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-success/10 border border-success/30 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="text-ink font-medium text-sm truncate">{selectedPartner.name}</p>
                          {(selectedPartner.phone || selectedPartner.city) && (
                            <p className="text-ink-muted text-xs">
                              {[selectedPartner.phone, [selectedPartner.zip, selectedPartner.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => { setSelectedPartner(null); setPartnerQuery('') }}
                          className="text-ink-muted hover:text-ink p-1">
                          <X size={14} />
                        </button>
                      </div>
                    ) : showCreate ? (
                      <div className="bg-surface-2 border rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-ink font-medium text-sm">Nouveau client</p>
                          <button onClick={() => setShowCreate(false)} className="text-xs text-ink-muted hover:text-ink underline">
                            Annuler
                          </button>
                        </div>
                        <input value={newPartnerName} onChange={e => setNewPartnerName(e.target.value)}
                          placeholder="Nom Prénom *" className="w-full px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-brand" />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={newPartnerEmail} onChange={e => setNewPartnerEmail(e.target.value)} type="email"
                            placeholder="Email" className="px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-brand" />
                          <input value={newPartnerPhone} onChange={e => setNewPartnerPhone(e.target.value)} type="tel"
                            placeholder="Téléphone" className="px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-brand" />
                        </div>
                        <input value={newPartnerStreet} onChange={e => setNewPartnerStreet(e.target.value)}
                          placeholder="Rue + numéro" className="w-full px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-brand" />
                        <div className="grid grid-cols-3 gap-2">
                          <input value={newPartnerZip} onChange={e => setNewPartnerZip(e.target.value)}
                            placeholder="CP" className="px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-brand" />
                          <input value={newPartnerCity} onChange={e => setNewPartnerCity(e.target.value)}
                            placeholder="Ville" className="col-span-2 px-3 py-2 bg-surface border rounded-lg text-sm text-ink focus:outline-none focus:border-brand" />
                        </div>
                        <button
                          onClick={handleCreatePartner}
                          disabled={creatingPartner || !newPartnerName.trim()}
                          className="w-full px-3 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-lg disabled:opacity-50 transition flex items-center justify-center gap-2">
                          {creatingPartner ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                          Créer dans Odoo
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                          <input
                            value={partnerQuery}
                            onChange={e => setPartnerQuery(e.target.value)}
                            placeholder="Recherche par nom ou téléphone (3+ caractères)…"
                            className="w-full pl-9 pr-3 py-2 bg-surface-2 border rounded-lg text-sm text-ink focus:outline-none focus:border-brand"
                          />
                        </div>
                        {partnerLoading && (
                          <div className="text-ink-muted text-xs px-3 py-2 flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin" /> Recherche…
                          </div>
                        )}
                        {partnerResults.length > 0 && (
                          <div className="border rounded-lg max-h-60 overflow-y-auto">
                            {partnerResults.map(p => (
                              <button
                                key={p.id}
                                onClick={() => { setSelectedPartner(p); setStep(3) }}
                                className="w-full text-left px-3 py-2 hover:bg-surface-hover border-b last:border-b-0 transition">
                                <p className="text-ink text-sm font-medium">{p.name}</p>
                                {(p.phone || p.city) && (
                                  <p className="text-ink-muted text-xs mt-0.5">
                                    {[p.phone, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {partnerQuery.length >= 3 && !partnerLoading && partnerResults.length === 0 && (
                          <p className="text-ink-muted text-xs px-3">Aucun client trouvé</p>
                        )}
                        <button
                          onClick={() => setShowCreate(true)}
                          className="w-full px-3 py-2 bg-surface-2 hover:bg-surface-hover border border-dashed rounded-lg text-sm text-ink-secondary hover:text-ink transition flex items-center justify-center gap-2">
                          <UserPlus size={14} />
                          Nouveau client
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Tarif + paiements */}
                  {selectedPartner && (
                    <>
                      <div className="bg-surface-2 border rounded-xl p-3 space-y-1.5 text-sm">
                        <div className="flex justify-between text-ink-secondary">
                          <span>{sourceConfig.forfaitLabel}</span>
                          <span>{forfait.toFixed(2)} € HT</span>
                        </div>
                        <div className="flex justify-between text-ink-secondary">
                          <span>
                            Gardiennage ({days} jour{days !== 1 ? 's' : ''} × 20€)
                            {minApplied && (
                              <span className="ml-1 text-rose-500 text-xs font-medium">(min {sourceConfig.minDays}j)</span>
                            )}
                          </span>
                          <span>{gardien.toFixed(2)} € HT</span>
                        </div>
                        <div className="flex justify-between text-ink-muted text-xs border-t pt-1.5">
                          <span>Total HTVA</span>
                          <span>{totalHtva.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between text-ink-muted text-xs">
                          <span>TVA 21%</span>
                          <span>{(totalHtva * TVA_RATE).toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between text-ink font-bold border-t pt-1.5">
                          <span>Total à payer TVAC</span>
                          <span>{totalTvac.toFixed(2)} €</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-ink text-sm font-medium">Paiements</label>
                          <button onClick={addPayment}
                            className="text-xs text-brand hover:underline flex items-center gap-1">
                            <Plus size={12} /> Ajouter un mode
                          </button>
                        </div>
                        {payments.map((p, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <select value={p.mode}
                              onChange={e => updatePayment(i, { mode: e.target.value as PaymentMode })}
                              className="px-3 py-2 bg-surface-2 border rounded-lg text-sm text-ink focus:outline-none focus:border-brand">
                              <option value="cash">💵 Espèces</option>
                              <option value="bancontact">💳 Bancontact</option>
                              <option value="driver_encaissement">🚛 Encaissement chauffeur</option>
                            </select>
                            <div className="flex-1 relative">
                              <input value={p.amount}
                                onChange={e => updatePayment(i, { amount: e.target.value })}
                                type="number" step="0.01" min="0"
                                placeholder="0,00"
                                onFocus={() => { if (!p.amount) autoFillRemaining(i) }}
                                className="w-full px-3 py-2 pr-10 bg-surface-2 border rounded-lg text-sm text-ink focus:outline-none focus:border-brand" />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted text-xs">€</span>
                            </div>
                            {payments.length > 1 && (
                              <button onClick={() => removePayment(i)}
                                className="p-2 text-ink-muted hover:text-critical">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center justify-between text-xs px-1">
                          <span className="text-ink-muted">Total saisi : <strong className="text-ink">{sumPayments.toFixed(2)} €</strong></span>
                          <span className={`font-medium ${
                            paymentsValid ? 'text-success' : remaining > 0 ? 'text-warning' : 'text-critical'
                          }`}>
                            {paymentsValid ? '✓ OK'
                              : remaining > 0 ? `Reste à payer : ${remaining.toFixed(2)} €`
                              : `Trop payé : ${Math.abs(remaining).toFixed(2)} €`}
                          </span>
                        </div>
                      </div>

                      {/* Indicateur du flow */}
                      <div className="bg-info/5 border border-info/30 rounded-lg p-3 text-xs text-ink-secondary">
                        {userHasOdooAccess ? (
                          <>📄 Tu as accès Odoo : la validation créera <strong>le devis Odoo direct</strong>, mission passera à <strong>completed</strong>.</>
                        ) : (
                          <>🚛 Pas d&apos;accès Odoo : on bascule sur le module <strong>Encaissement Chauffeur</strong> (mission passe à to_invoice, devis Odoo créé plus tard par le service Facturation).</>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

            </>
          )}

          {/* Erreur */}
          {err && (
            <div className="bg-critical/10 border border-critical/40 rounded-lg p-3 text-critical text-sm">
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose}
            className="px-4 py-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-ink-secondary hover:text-ink text-sm transition">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              submitting
              || (mission.police_blocked && !policeVerified)
              || (noChargeMode ? !noChargeReason.trim()
                  : !selectedPartner || !paymentsValid)
            }
            className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition flex items-center gap-2">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {noChargeMode ? 'Restituer sans frais'
              : userHasOdooAccess ? 'Restituer + Devis Odoo'
              : 'Restituer + Encaissement chauffeur'}
          </button>
        </div>

      </div>
    </div>
  )
}

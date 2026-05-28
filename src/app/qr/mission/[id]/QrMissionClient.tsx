'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, Truck, Loader2, AlertTriangle, CheckCircle2, Building2, AlertOctagon, Printer, ExternalLink, MapPin, Calendar, FileText } from 'lucide-react'
import { FOURRIERE_ZONES, SCRATCH_STATE_ID } from '@/lib/fourriere'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'

interface Mission {
  id:                 string
  mission_number:     number | null
  external_id:        string | null
  dossier_number:     string | null
  source:             string | null
  mission_type:       string | null
  status:             string
  vehicle_plate:      string | null
  vehicle_vin:        string | null
  vehicle_brand:      string | null
  vehicle_model:      string | null
  client_name:        string | null
  billed_to_name:     string | null
  // Adresse intervention (lieu ou la mission a ete prise en charge)
  incident_address:   string | null
  incident_city:      string | null
  destination_address: string | null
  destination_city:    string | null
  parc_zone_key:      string | null
  parc_row_number:    number | null
  parc_slot_index:    number | null
  intervention_date:  string | null
  received_at:        string | null
  parked_at:          string | null
  incident_type:      string | null
  odoo_ticket_id:     number | null
}

interface ExistingRel {
  id:             string
  mission_number: number | null
  external_id:    string | null
  status:         string
  assigned_to:    string | null
  assigneeName:   string | null
}

interface CurrentUser {
  id:        string
  name:      string
  isDriver:  boolean
}

interface Permissions {
  canFourriereActions: boolean   // Transferer / Domaine / Scratch / Imprimer
  canOpenOdoo:         boolean   // Lien direct Odoo (besoin odoo_api_key)
  canConsulterDossier: boolean   // Consulter le dossier (admin/superadmin/dispatcher)
}

const DOMAINE_STATE_ID = 13   // Zone I — Domaine

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return '—' }
}

export default function QrMissionClient({
  mission, existingRel, currentUser, permissions, consultUrl, isElligibleForRel,
}: {
  mission:            Mission
  existingRel:        ExistingRel | null
  currentUser:        CurrentUser
  permissions:        Permissions
  consultUrl:         string
  isElligibleForRel:  boolean
}) {
  const router = useRouter()
  const [working,      setWorking]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [toast,        setToast]        = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [confirmingReassign, setConfirmingReassign] = useState(false)
  // Modales
  const [showNoCharge,   setShowNoCharge]   = useState(false)
  const [noChargeReason, setNoChargeReason] = useState('')
  const [actionMenu,     setActionMenu]     = useState<null | 'transfer' | 'domaine' | 'scratch'>(null)
  const [selectedState,  setSelectedState]  = useState<number | null>(null)

  function showToast(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), 3500)
  }

  const brandModel = [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')
  const address    = [mission.destination_address, mission.destination_city].filter(Boolean).join(', ')
  const entryDate  = mission.parked_at || mission.intervention_date || mission.received_at

  // Bouton "Relivrer" disponible si mission eligible REL + user driver
  const canRelivrer = isElligibleForRel && currentUser.isDriver
  // Existing REL deja prise par quelqu un d autre que le scanneur
  const existingTakenByOther = existingRel?.assigned_to && existingRel.assigned_to !== currentUser.id

  // Sources fourriere : possibilite d encaisser via Restituer
  const RESTITUABLE_SOURCES = ['police_mg', 'police_rodeo', 'police_avp', 'police_snc', 'sia_couvert', 'prive']
  const canRestituer = mission.status === 'parked' && RESTITUABLE_SOURCES.includes(mission.source || '')

  async function doRelivrer(confirmReassign: boolean = false) {
    setWorking(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${mission.id}/qr-rel-action`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ confirm_reassign: confirmReassign }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        if (j.needs_confirm) { setConfirmingReassign(true); setWorking(false); return }
        throw new Error(j.error || 'Erreur')
      }
      router.push(j.redirect_url || `/mission/${j.mission_id}`)
    } catch (e: any) {
      setError(e.message); setWorking(false)
    }
  }

  async function doRestituerSansFrais() {
    const reason = noChargeReason.trim()
    if (!reason) { setError('Motif obligatoire'); return }
    setWorking(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${mission.id}/restitute`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode: 'no_charge', no_charge_reason: reason }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      router.push(`/dispatch/${mission.id}`)
    } catch (e: any) {
      setError(e.message); setWorking(false)
    }
  }

  // Actions fourriere : utilise les endpoints /api/helpdesk/[ticketId]/...
  // (move / print). Requiert odoo_ticket_id. Si pas dispo (Appel Prive sans
  // ticket), les boutons fourriere sont desactives avec message clair.
  async function doMoveZone(toStateId: number) {
    if (!mission.odoo_ticket_id) {
      showToast('err', 'Action impossible : ticket Odoo absent pour cette mission')
      setActionMenu(null); setSelectedState(null)
      return
    }
    setWorking(true)
    try {
      const r = await fetch(`/api/helpdesk/${mission.odoo_ticket_id}/move`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ to_state_id: toStateId }),
      })
      const j = await r.json()
      if (!r.ok) { showToast('err', j.error || 'Erreur transfert'); return }
      showToast('ok', `Véhicule transféré : ${j.to_state_name || 'OK'}`)
      setActionMenu(null); setSelectedState(null)
      // Recharge la page pour voir les nouvelles infos
      setTimeout(() => window.location.reload(), 1500)
    } finally { setWorking(false) }
  }

  async function doPrint() {
    setWorking(true)
    try {
      // Utilise le endpoint VD Soft reprint-label (= URL QR vers /qr/mission/[id]
      // + meme template ZPL, plus de cohesion avec le nouveau flow).
      const r = await fetch(`/api/missions/${mission.id}/reprint-label`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { showToast('err', j.error || 'Erreur impression'); return }
      showToast('ok', 'Étiquette envoyée à l\'imprimante')
    } finally { setWorking(false) }
  }

  return (
    <div className="min-h-screen bg-bg-page py-6 px-4 safe-top safe-bottom">
      <div className="max-w-md mx-auto space-y-4">

        {/* Header */}
        <header className="text-center pb-2">
          <p className="text-ink-muted text-xs uppercase tracking-widest font-semibold">Scan étiquette · Fourrière</p>
          <h1 className="text-ink text-xl font-bold mt-1">
            {mission.mission_number != null ? `#${mission.mission_number}` : `Mission ${mission.id.slice(0, 8)}`}
          </h1>
        </header>

        {/* Toast */}
        {toast && (
          <div className={`rounded-xl p-3 text-sm font-medium ${
            toast.kind === 'ok' ? 'bg-success-soft border border-success/30 text-success' : 'bg-critical-soft border border-critical text-critical'
          }`}>
            {toast.kind === 'ok' ? '✅ ' : '⚠ '}{toast.msg}
          </div>
        )}

        {/* Carte véhicule enrichie */}
        <div className="bg-surface border rounded-2xl p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ink-muted text-xs uppercase tracking-wider">Plaque</p>
              <p className="text-ink text-3xl font-bold font-mono tracking-wide mt-0.5">
                {mission.vehicle_plate || '—'}
              </p>
              {brandModel && (
                <p className="text-ink-secondary text-sm mt-0.5">{brandModel}</p>
              )}
            </div>
            {mission.parc_zone_key && (
              <div className="flex-shrink-0 text-center">
                <div className="text-3xl font-display font-extrabold text-brand">{mission.parc_zone_key}</div>
                <div className="text-[10px] uppercase tracking-wider text-ink-faint">Zone</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t">
            <Field icon={<MapPin size={12} />} label="Zone actuelle" value={
              mission.parc_zone_key
                ? `${mission.parc_zone_key}${mission.parc_row_number ? `-${mission.parc_row_number}` : ''}${mission.parc_slot_index != null ? `/${mission.parc_slot_index}` : ''}`
                : '—'
            } />
            <Field icon={<Calendar size={12} />} label="Entrée parc" value={fmtDate(entryDate)} />
            {mission.vehicle_vin && <Field icon={<FileText size={12} />} label="VIN" value={mission.vehicle_vin} mono />}
            {mission.source && <Field icon={<AlertOctagon size={12} />} label="Source" value={mission.source.toUpperCase()} />}
            {mission.billed_to_name && <Field icon={<FileText size={12} />} label="Assistance" value={mission.billed_to_name} />}
            {mission.dossier_number && <Field icon={<FileText size={12} />} label="Dossier" value={mission.dossier_number} mono />}
          </div>

          {address && (
            <div className="pt-2 border-t">
              <p className="text-ink-muted text-xs uppercase tracking-wider">Destination relivraison</p>
              <p className="text-ink mt-0.5 leading-tight text-sm">{address}</p>
            </div>
          )}
        </div>

        {/* REL existante */}
        {existingRel && (
          <div className={`rounded-2xl p-4 flex gap-3 ${
            existingTakenByOther ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-success-soft border border-success/30'
          }`}>
            {existingTakenByOther
              ? <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
              : <CheckCircle2  className="text-success    flex-shrink-0 mt-0.5" size={18} />}
            <div className="flex-1">
              {existingTakenByOther ? (
                <>
                  <p className="font-semibold text-ink text-sm">REL déjà assignée</p>
                  <p className="text-ink-muted text-xs mt-1">
                    {existingRel.assigneeName || 'Un autre chauffeur'} a pris cette relivraison
                    ({existingRel.mission_number != null ? `#${existingRel.mission_number}` : existingRel.external_id}).
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-ink text-sm">Tu es assigné à cette REL</p>
                  <p className="text-ink-muted text-xs mt-1">Continue vers la fiche pour démarrer.</p>
                </>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-critical-soft border border-critical rounded-2xl p-3 text-critical text-sm">
            ⚠ {error}
          </div>
        )}

        {/* Confirmation réassignation REL */}
        {confirmingReassign && (
          <div className="bg-amber-500/10 border-2 border-amber-500/50 rounded-2xl p-4">
            <p className="font-semibold text-ink text-sm mb-2">⚠️ Reprendre la REL ?</p>
            <p className="text-ink-muted text-xs mb-3">
              {existingRel?.assigneeName || 'Un autre chauffeur'} est actuellement assigné(e). Confirme pour t&apos;assigner à la place.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingReassign(false)} disabled={working}
                className="flex-1 py-2 bg-surface border text-ink-secondary rounded-xl text-sm font-medium hover:bg-surface-hover transition">
                Annuler
              </button>
              <button onClick={() => doRelivrer(true)} disabled={working}
                className="flex-1 py-2 bg-amber-500 hover:opacity-90 text-white rounded-xl text-sm font-bold transition">
                {working ? '...' : 'Oui, prendre'}
              </button>
            </div>
          </div>
        )}

        {/* Modal Restituer sans frais (motif obligatoire) */}
        {showNoCharge && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-amber-900 font-semibold text-sm">🆓 Restitution sans frais</p>
              <p className="text-amber-800 text-xs mt-1 leading-relaxed">
                Motif obligatoire — consigné dans le dossier pour audit.
              </p>
            </div>
            <textarea
              value={noChargeReason}
              onChange={e => setNoChargeReason(e.target.value)}
              rows={3}
              placeholder="Motif (ex : demande direction, geste commercial...)"
              className="w-full bg-surface border border-strong rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-amber-500"
            />
            <div className="flex gap-2">
              <button onClick={() => { setShowNoCharge(false); setNoChargeReason(''); setError(null) }}
                disabled={working}
                className="flex-1 py-2.5 bg-surface border text-ink-secondary rounded-xl text-sm font-medium hover:bg-surface-hover transition">
                Annuler
              </button>
              <button onClick={doRestituerSansFrais}
                disabled={working || !noChargeReason.trim()}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition disabled:opacity-40">
                {working ? <><Loader2 size={16} className="inline animate-spin" /> ...</> : 'Confirmer'}
              </button>
            </div>
          </div>
        )}

        {/* Modal Transférer zone (sélection FOURRIERE_ZONES) */}
        {actionMenu === 'transfer' && (
          <div className="bg-surface border-2 border-brand/30 rounded-2xl p-4 space-y-3">
            <p className="font-semibold text-ink text-sm">🚛 Transférer vers une zone</p>
            <div className="grid grid-cols-3 gap-2">
              {FOURRIERE_ZONES.map(z => (
                <button key={z.state_id}
                  onClick={() => setSelectedState(z.state_id)}
                  className={`p-3 rounded-xl border text-center transition ${
                    selectedState === z.state_id ? 'bg-brand text-white border-brand shadow' : 'bg-surface-2 hover:bg-surface-hover border-surface-hover'
                  }`}>
                  <div className="font-display font-bold text-lg">{z.code}</div>
                  <div className="text-[10px] text-ink-faint truncate">{z.description || z.label}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setActionMenu(null); setSelectedState(null) }} disabled={working}
                className="flex-1 py-2 bg-surface-2 border text-ink-secondary rounded-xl text-sm font-medium">
                Annuler
              </button>
              <button onClick={() => selectedState && doMoveZone(selectedState)}
                disabled={!selectedState || working}
                className="flex-1 py-2 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white rounded-xl text-sm font-bold">
                {working ? '...' : 'Transférer'}
              </button>
            </div>
          </div>
        )}

        {/* Modal Envoyer au Domaine */}
        {actionMenu === 'domaine' && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 space-y-3">
            <p className="font-semibold text-ink text-sm">🏢 Envoyer au Domaine ?</p>
            <p className="text-amber-800 text-xs">Le véhicule sera transféré vers la zone I — Domaine.</p>
            <div className="flex gap-2">
              <button onClick={() => setActionMenu(null)} disabled={working}
                className="flex-1 py-2 bg-surface border text-ink-secondary rounded-xl text-sm font-medium">
                Annuler
              </button>
              <button onClick={() => doMoveZone(DOMAINE_STATE_ID)} disabled={working}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold">
                {working ? '...' : 'Confirmer'}
              </button>
            </div>
          </div>
        )}

        {/* Modal Scratch / Mettre en épave */}
        {actionMenu === 'scratch' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 space-y-3">
            <p className="font-semibold text-red-900 text-sm">⚠️ Scratch / Mettre en épave ?</p>
            <p className="text-red-800 text-xs">Le véhicule sera marqué comme épave. Action irréversible côté Odoo.</p>
            <div className="flex gap-2">
              <button onClick={() => setActionMenu(null)} disabled={working}
                className="flex-1 py-2 bg-surface border text-ink-secondary rounded-xl text-sm font-medium">
                Annuler
              </button>
              <button onClick={() => doMoveZone(SCRATCH_STATE_ID)} disabled={working}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold">
                {working ? '...' : 'Confirmer scratch'}
              </button>
            </div>
          </div>
        )}

        {/* Actions principales — affichage conditionnel par permission */}
        {!confirmingReassign && !showNoCharge && !actionMenu && (
          <div className="space-y-3 pt-2">

            {/* Relivrer (driver seulement) */}
            {canRelivrer && (
              <button onClick={() => doRelivrer(false)} disabled={working}
                className="w-full py-4 bg-brand hover:opacity-90 text-white rounded-2xl text-base font-bold transition disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-brand/20">
                {working ? <><Loader2 size={20} className="animate-spin" /> Création...</> : <><Truck size={20} /> Relivrer ce véhicule</>}
              </button>
            )}

            {/* Restituer (tous users auth) */}
            {canRestituer && (
              <>
                <button
                  onClick={() => {
                    const url = buildEncaissementUrl(mission as any, {
                      returnTo: `/dispatch/${mission.id}`,
                    })
                    window.location.href = url
                  }}
                  disabled={working}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-base font-bold transition disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
                  💳 Restituer (avec paiement)
                </button>
                <button onClick={() => setShowNoCharge(true)} disabled={working}
                  className="w-full py-3 bg-surface border-2 border-amber-400 text-amber-700 hover:bg-amber-50 rounded-2xl text-sm font-bold transition disabled:opacity-40">
                  🆓 Restituer sans frais
                </button>
              </>
            )}

            {/* Actions fourrière (admin / superadmin / module fourriere) */}
            {permissions.canFourriereActions && (
              <>
                <button onClick={() => setActionMenu('transfer')} disabled={working}
                  className="w-full py-3 bg-surface border-2 border-brand/40 text-brand hover:bg-brand/5 rounded-2xl text-sm font-bold transition flex items-center justify-center gap-2">
                  <Truck size={18} /> Transférer vers une zone
                </button>
                <button onClick={() => setActionMenu('domaine')} disabled={working}
                  className="w-full py-3 bg-surface border-2 border-amber-400 text-amber-700 hover:bg-amber-50 rounded-2xl text-sm font-bold transition flex items-center justify-center gap-2">
                  <Building2 size={18} /> Envoyer au Domaine
                </button>
                <button onClick={() => setActionMenu('scratch')} disabled={working}
                  className="w-full py-3 bg-surface border-2 border-red-400 text-red-700 hover:bg-red-50 rounded-2xl text-sm font-bold transition flex items-center justify-center gap-2">
                  <AlertOctagon size={18} /> Scratch / Mettre en épave
                </button>
              </>
            )}

            {/* Outils — Imprimer (fourriere) + Ouvrir Odoo (clé API) */}
            {(permissions.canFourriereActions || permissions.canOpenOdoo) && (
              <div className="bg-surface border rounded-2xl p-3 space-y-2">
                {permissions.canFourriereActions && (
                  <button onClick={doPrint} disabled={working}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2">
                    {working ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                    Imprimer une étiquette
                  </button>
                )}
                {permissions.canOpenOdoo && mission.odoo_ticket_id && (
                  <a
                    href={`https://verviers-depannage.odoo.com/web#id=${mission.odoo_ticket_id}&model=helpdesk.ticket&view_type=form`}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-2 justify-center py-2.5 rounded-xl bg-surface-2 hover:bg-surface-hover transition border text-ink-secondary hover:text-ink text-sm font-medium">
                    <ExternalLink size={16} /> Ouvrir dans Odoo
                  </a>
                )}
              </div>
            )}

            {/* Consulter le dossier (dispatcher / admin / superadmin uniquement
                — Olivier 2026-05-27 : pas pour drivers ni autres roles) */}
            {permissions.canConsulterDossier && (
              <Link href={consultUrl}
                className="w-full py-3 bg-surface border-2 text-ink hover:bg-surface-hover rounded-2xl text-base font-medium transition flex items-center justify-center gap-2">
                <Eye size={18} /> Consulter le dossier
              </Link>
            )}
          </div>
        )}

        <div className="text-center pt-4">
          <p className="text-ink-faint text-xs">
            Connecté en tant que <span className="font-medium">{currentUser.name}</span>
          </p>
        </div>

      </div>
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────────────────────
function Field({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-ink-faint mb-0.5">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-ink-secondary ${mono ? 'font-mono text-xs' : 'text-sm'} truncate`} title={value}>
        {value}
      </p>
    </div>
  )
}

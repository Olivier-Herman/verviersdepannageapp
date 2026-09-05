'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, Truck, Loader2, AlertTriangle, CheckCircle2, Building2, AlertOctagon, Printer, ExternalLink, MapPin, Calendar, FileText } from 'lucide-react'
import { FOURRIERE_ZONES, SCRATCH_STATE_ID } from '@/lib/fourriere'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import { parcZoneLabel } from '@/lib/parc/zone-label'
import AddressField from '@/components/AddressField'

const GM_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

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
  redelivery_address:  string | null
  parc_zone_key:      string | null
  parc_row_number:    number | null
  parc_slot_index:    number | null
  intervention_date:  string | null
  received_at:        string | null
  parked_at:          string | null
  incident_type:      string | null
  odoo_ticket_id:     number | null
  scratched_at:       string | null
  closing_notes:      string | null
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
  canRelivrerAsDispatcher: boolean  // Dispatcher peut creer REL + selectionner chauffeur cible
}

const DOMAINE_STATE_ID = 13   // Zone I — Domaine

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return '—' }
}

export default function QrMissionClient({
  mission, existingRel, currentUser, permissions, consultUrl, isElligibleForRel, activeDrivers = [], relZoneType = false,
  exitBlocked = null,
}: {
  mission:            Mission
  existingRel:        ExistingRel | null
  currentUser:        CurrentUser
  permissions:        Permissions
  consultUrl:         string
  isElligibleForRel:  boolean
  activeDrivers?:     { id: string; name: string }[]   // pour selecteur Relivrer dispatcher
  relZoneType?:       boolean   // zone de type relivraison/accident → saisie adresse possible au scan
  // Contrôle de sortie (épave gérée par un bureau d'expertise) : motif du
  // blocage, ou null si la sortie est libre. Olivier 2026-09-05.
  exitBlocked?:       string | null
}) {
  const router = useRouter()
  const [working,      setWorking]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [toast,        setToast]        = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [confirmingReassign, setConfirmingReassign] = useState(false)
  // Modales
  const [showRelConfirm, setShowRelConfirm] = useState(false)
  // Selecteur chauffeur (dispatcher uniquement) — vide = auto-assign au scanneur
  const [selectedDriverId, setSelectedDriverId] = useState<string>('')
  const [showNoCharge,   setShowNoCharge]   = useState(false)
  const [noChargeReason, setNoChargeReason] = useState('')
  const [actionMenu,     setActionMenu]     = useState<null | 'transfer' | 'domaine' | 'scratch'>(null)
  const [selectedState,  setSelectedState]  = useState<number | null>(null)
  // Saisie de l'adresse de relivraison au scan (véhicule sans adresse, zone rel/accident)
  const [relAddr, setRelAddr] = useState(mission.redelivery_address || '')
  const [relLat,  setRelLat]  = useState<number | null>(null)
  const [relLng,  setRelLng]  = useState<number | null>(null)

  function showToast(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), 3500)
  }

  const brandModel = [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')
  const address    = [mission.destination_address, mission.destination_city].filter(Boolean).join(', ')
  const entryDate  = mission.parked_at || mission.intervention_date || mission.received_at
  // Adresse de relivraison connue ? Sinon, si zone rel/accident, saisie au scan.
  const relAddress       = mission.redelivery_address || ''
  const needsAddressEntry = !relAddress && relZoneType

  // Bouton "Relivrer" disponible si mission eligible REL + (driver OU dispatcher avec selecteur).
  // Olivier 2026-05-28 : ajout dispatcher avec selecteur chauffeur.
  const canRelivrer = isElligibleForRel && (currentUser.isDriver || permissions.canRelivrerAsDispatcher)
  const isDispatcherMode = !currentUser.isDriver && permissions.canRelivrerAsDispatcher
  // Existing REL deja prise par quelqu un d autre que le scanneur
  const existingTakenByOther = existingRel?.assigned_to && existingRel.assigned_to !== currentUser.id

  // Sources fourriere : possibilite d encaisser via Restituer
  const RESTITUABLE_SOURCES = ['police_mg', 'police_rodeo', 'police_avp', 'police_snc', 'sia_couvert', 'prive']
  const canRestituer = mission.status === 'parked' && RESTITUABLE_SOURCES.includes(mission.source || '') && !exitBlocked

  async function doRelivrer(confirmReassign: boolean = false) {
    // En mode dispatcher : selection chauffeur obligatoire
    if (isDispatcherMode && !selectedDriverId) {
      setError('Sélectionne un chauffeur à qui assigner la relivraison')
      return
    }
    setWorking(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${mission.id}/qr-rel-action`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          confirm_reassign:        confirmReassign,
          // Olivier 2026-05-28 : si dispatcher, on envoie le chauffeur cible
          // (sinon backend auto-assign au scanneur).
          assigned_to_driver_id:   isDispatcherMode ? selectedDriverId : undefined,
          // Olivier 2026-06-22 : adresse saisie au scan (véhicule sans adresse).
          redelivery_address:      relAddr.trim() || undefined,
          redelivery_lat:          relLat ?? undefined,
          redelivery_lng:          relLng ?? undefined,
        }),
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

  // Contrôle de sortie : lance la procédure complète sur ce téléphone
  // (jeton 45 min, même module que le QR de la fiche dispatch).
  async function startExitProcedure() {
    setWorking(true); setError(null)
    try {
      const r = await fetch('/api/capture/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: mission.id, kind: 'restitution' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Procédure indisponible (accès bureau requis)')
      window.location.href = j.url
    } catch (e: any) { setError(e.message); setWorking(false) }
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

  // Olivier 2026-06-08 : transfert de zone via VD Soft (transfer-parc) au
  // lieu d Odoo helpdesk. Plus de blocage 'ticket Odoo absent'. Le mapping
  // state_id Odoo -> zone_key VD Soft est fait via FOURRIERE_ZONES local.
  // L action 'Scratch / Mettre en epave' reste sur l ancien endpoint helpdesk
  // car c est un changement d etat metier different (a migrer ulterieurement).
  async function doMoveZone(toStateId: number) {
    // Cas Scratch / Épave : endpoint VD Soft dédié (status='completed' +
    // libère parc + log + sync Odoo best-effort si fleet.vehicle dispo).
    if (toStateId === SCRATCH_STATE_ID) {
      if (!confirm('Mettre ce véhicule en épave ? Il sortira du parc et passera en statut clôturé.')) {
        setActionMenu(null); setSelectedState(null)
        return
      }
      setWorking(true)
      try {
        const r = await fetch(`/api/missions/${mission.id}/scratch`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({}),
        })
        const j = await r.json()
        if (!r.ok) { showToast('err', j.error || 'Erreur scratch'); return }
        showToast('ok', j.message || 'Véhicule mis en épave')
        setActionMenu(null); setSelectedState(null)
        setTimeout(() => window.location.reload(), 1500)
      } finally { setWorking(false) }
      return
    }

    // Cas Transferer vers zone / Envoyer au Domaine : VD Soft transfer-parc
    const zoneConf = FOURRIERE_ZONES.find(z => z.state_id === toStateId)
    if (!zoneConf) {
      showToast('err', `Zone introuvable (state_id=${toStateId})`)
      setActionMenu(null); setSelectedState(null)
      return
    }
    setWorking(true)
    try {
      const r = await fetch(`/api/missions/${mission.id}/transfer-parc`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ zone_key: zoneConf.code }),
      })
      const j = await r.json()
      if (!r.ok) { showToast('err', j.error || 'Erreur transfert'); return }
      showToast('ok', `Véhicule transféré vers zone ${zoneConf.label}`)
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

        {/* Olivier 2026-06-08 : tampon ÉPAVE si la mission a ete mise en epave */}
        {mission.scratched_at && (
          <div className="bg-red-50 border-2 border-red-500 rounded-2xl p-5 text-center">
            <div className="inline-block transform -rotate-3 border-4 border-red-600 text-red-700 px-6 py-2 rounded-lg bg-red-100/60">
              <p className="text-4xl font-extrabold tracking-widest font-display">ÉPAVE</p>
              <p className="text-xs mt-1 text-red-800">
                Mis en épave le {new Date(mission.scratched_at).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </p>
            </div>
            {mission.closing_notes && (
              <p className="text-xs text-red-800 mt-3 italic">{mission.closing_notes}</p>
            )}
            <p className="text-xs text-ink-muted mt-3">
              ⛔ Aucune action fourrière possible. Véhicule sorti du parc, statut clôturé.
            </p>
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
                <div className="text-2xl font-display font-extrabold text-brand">{parcZoneLabel(mission.parc_zone_key)}</div>
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

        {/* Modal confirmation Relivrer — affiche adresse de relivraison +
            véhicule pour éviter les erreurs (mauvais véhicule de même marque/modele).
            Si dispatcher : selecteur chauffeur cible.
            Olivier 2026-05-28. */}
        {showRelConfirm && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4 space-y-3">
            <p className="text-blue-900 font-semibold text-sm">🚛 Confirmer la relivraison</p>
            <div className="bg-surface border rounded-xl p-3 space-y-1.5">
              <div>
                <p className="text-ink-muted text-xs uppercase tracking-wider">Véhicule à relivrer</p>
                <p className="text-ink font-mono font-bold">{mission.vehicle_plate || '—'}</p>
                {brandModel && <p className="text-ink-secondary text-sm">{brandModel}</p>}
              </div>
              <div className="pt-2 border-t">
                <p className="text-ink-muted text-xs uppercase tracking-wider">Adresse de relivraison</p>
                {relAddress ? (
                  <p className="text-ink text-sm leading-tight">{relAddress}</p>
                ) : needsAddressEntry ? (
                  <div className="mt-1">
                    <AddressField
                      value={relAddr}
                      onChange={setRelAddr}
                      onSelect={(a, la, ln) => { setRelAddr(a); setRelLat(la); setRelLng(ln) }}
                      gmKey={GM_KEY}
                      placeholder="Saisis l'adresse de relivraison"
                    />
                    <p className="text-amber-700 text-xs mt-1.5">
                      ⚠ Un dispatcher sera notifié pour confirmer cette adresse.
                    </p>
                  </div>
                ) : (
                  <p className="text-amber-700 text-xs italic">
                    ⚠ Pas d&apos;adresse définie — contacte le dispatcher avant de partir
                  </p>
                )}
              </div>
            </div>

            {/* Selecteur chauffeur en mode dispatcher */}
            {isDispatcherMode && (
              <div>
                <label className="block text-blue-900 text-xs font-semibold uppercase tracking-wider mb-1">
                  Assigner à un chauffeur <span className="text-critical">*</span>
                </label>
                <select
                  value={selectedDriverId}
                  onChange={e => setSelectedDriverId(e.target.value)}
                  className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-blue-500"
                >
                  <option value="">— Sélectionner un chauffeur —</option>
                  {activeDrivers.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <p className="text-blue-700 text-xs mt-1">
                  💡 Le chauffeur recevra une notification push avec la mission REL assignée.
                </p>
              </div>
            )}

            <p className="text-blue-800 text-xs">
              {isDispatcherMode
                ? `Merci de confirmer le véhicule et le chauffeur sélectionné.`
                : `Merci de confirmer qu'il s'agit bien du véhicule que tu souhaites relivrer.`}
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setShowRelConfirm(false); setSelectedDriverId(''); setError(null) }} disabled={working}
                className="flex-1 py-2.5 bg-surface border text-ink-secondary rounded-xl text-sm font-medium hover:bg-surface-hover transition">
                Annuler
              </button>
              <button onClick={() => { setShowRelConfirm(false); doRelivrer(false) }}
                disabled={working || (isDispatcherMode && !selectedDriverId) || (needsAddressEntry && !relAddr.trim())}
                className="flex-1 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-bold transition disabled:opacity-40">
                {working ? <><Loader2 size={16} className="inline animate-spin" /> ...</> : 'Confirmer'}
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
        {!confirmingReassign && !showNoCharge && !actionMenu && !showRelConfirm && (
          <div className="space-y-3 pt-2">

            {/* Relivrer (driver seulement) — ouvre une modal de confirmation
                avec l adresse de relivraison pour eviter qu un chauffeur prenne
                par erreur un vehicule de meme marque/modele (Olivier 2026-05-28). */}
            {canRelivrer && (
              <button onClick={() => setShowRelConfirm(true)} disabled={working}
                className="w-full py-4 bg-brand hover:opacity-90 text-white rounded-2xl text-base font-bold transition disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-brand/20">
                <Truck size={20} /> Relivrer ce véhicule
              </button>
            )}

            {/* Contrôle de sortie : véhicule géré par un bureau d'expertise,
                checklist incomplète → pas de restitution ni de relivraison
                depuis le hub. À compléter sur la fiche dispatch. */}
            {exitBlocked && mission.status === 'parked' && (
              <div className="w-full rounded-2xl border-2 border-critical/60 bg-critical/10 p-4 flex flex-col gap-2">
                <p className="text-critical font-black uppercase tracking-wide">🔒 Véhicule géré par un bureau d'expertise</p>
                <p className="text-ink text-sm">{exitBlocked}</p>
                <button onClick={startExitProcedure} disabled={working}
                  className="w-full py-3 bg-brand hover:bg-brand-hover text-white rounded-2xl text-sm font-bold transition disabled:opacity-40">
                  📱 Faire la procédure de sortie sur ce téléphone
                </button>
                <p className="text-ink-muted text-xs">Chemin de sortie, bon Informex, identité, CMR, attestation signée. Chaque étape est passable avec motif + PIN.</p>
              </div>
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

            {/* Actions fourrière (admin / superadmin / module fourriere)
                Olivier 2026-06-08 : masquees si la mission est en epave. */}
            {permissions.canFourriereActions && !mission.scratched_at && (
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
                {/* Olivier 2026-06-06 : acces direct fiche TowSoft pour photos */}
                {mission.external_id?.startsWith('TS-') && (
                  <a
                    href={`https://verviers.towsoft.ca/appel.php?num=${mission.external_id.replace(/^TS-/, '')}`}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-2 justify-center py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-sm font-medium transition">
                    <ExternalLink size={16} /> Voir fiche TowSoft (photos)
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

'use client'
// src/app/fourriere/VehicleFicheSheet.tsx
//
// Olivier 2026-06-03 : panel slide-over fiche complete vehicule en fourriere.
// 5 blocs : Vehicule, Intervention, Police, Parc, Tarif provisoire.
// Ouvert depuis FourriereSearchClient au clic sur une card resultat.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Car, FileText, ShieldAlert, MapPin, Calculator, ExternalLink, Loader2, Building2, Clock, User, Wrench, Hash, Receipt } from 'lucide-react'
import Link from 'next/link'
import RestituerEtFacturerModal from '@/components/fourriere/RestituerEtFacturerModal'
import SaisiePanel from '@/components/missions/SaisiePanel'

interface Fiche {
  mission: any
  zone:    any
  tarif:   { amount_tvac: number | null; htva: number | null; details: string[] }
}

export default function VehicleFicheSheet({ missionId, onClose, userModules = [], userRole = '' }: {
  missionId:    string
  onClose:      () => void
  userModules?: string[]
  userRole?:    string
}) {
  const router = useRouter()
  const [fiche, setFiche]     = useState<Fiche | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/fourriere/fiche/${missionId}`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Erreur')
        setFiche(j)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [missionId])

  // Échap pour fermer
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div className="bg-surface w-full max-w-xl h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="sticky top-0 z-10 bg-surface border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Car size={18} className="text-brand" />
            <h2 className="font-display text-lg font-bold text-ink">Fiche véhicule</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-hover rounded transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 flex-1">
          {loading && (
            <div className="text-center py-12 text-ink-muted text-sm">
              <Loader2 size={24} className="mx-auto animate-spin mb-3 text-brand" />
              Chargement de la fiche…
            </div>
          )}
          {error && (
            <div className="bg-critical/10 border border-critical/30 rounded-lg p-4 text-critical text-sm">
              {error}
            </div>
          )}
          {fiche && <FicheContent fiche={fiche} userModules={userModules} userRole={userRole} router={router} onClose={onClose} />}
        </div>
      </div>
    </div>
  )
}

function FicheContent({ fiche, userModules, userRole, router, onClose }: {
  fiche:       Fiche
  userModules: string[]
  userRole:    string
  router:      any
  onClose:     () => void
}) {
  const [showRestituerFacturer, setShowRestituerFacturer] = useState(false)
  const m = fiche.mission
  const z = fiche.zone
  const t = fiche.tarif
  const dispatchUrl   = `/dispatch/${m.id}`
  const driverUrl     = `/mission/${m.id}`
  // Hub unifie /qr/mission/[number] : porte les actions Restituer (avec/sans
  // frais), Transferer, Domaine, Scratch, Imprimer, etc. selon les permissions.
  const hubUrl = m.mission_number ? `/qr/mission/${m.mission_number}` : `/qr/mission/${m.id}`

  return (
    <div className="space-y-4">

      {/* Bandeau identité véhicule */}
      <div className="bg-surface-2 border rounded-card p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-ink-muted text-xs uppercase tracking-wide">Plaque</p>
            <p className="font-mono text-2xl font-bold text-ink">{m.vehicle_plate || '—'}</p>
          </div>
          <div className="text-right">
            <p className="text-ink-muted text-xs uppercase tracking-wide">Mission</p>
            <p className="font-mono text-base text-ink">#{m.mission_number || m.external_id || '—'}</p>
            {m.dossier_number && <p className="text-xs text-ink-muted">Dossier : {m.dossier_number}</p>}
          </div>
        </div>
        <div className="mt-3 pt-3 border-t flex items-center gap-3 flex-wrap">
          <span className="text-ink font-semibold">{[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}</span>
          {m.vehicle_class && <span className="text-xs px-1.5 py-0.5 bg-ink/5 text-ink-muted rounded">{m.vehicle_class}</span>}
          {m.vehicle_vin && <span className="font-mono text-xs text-ink-secondary">VIN {m.vehicle_vin}</span>}
        </div>
      </div>

      {/* Bloc Intervention */}
      <Section icon={<Wrench size={14} />} title="Intervention">
        <Row label="Source" value={
          m.source
            ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ${m.source_color || 'bg-zinc-600'}`}>
                {m.source_label || m.source.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
              </span>
            : '—'
        } />
        <Row label="Type" value={m.mission_type || '—'} />
        {m.snc_scenario && <Row label="Scénario SNC" value={m.snc_scenario} />}
        <Row label="Reçue" value={fmtDateTime(m.received_at)} />
        <Row label="Intervention" value={fmtDateTime(m.intervention_date)} />
        {m.client_name && <Row label="Client (sur place)" value={m.client_name} />}
        {m.billed_to_name && m.billed_to_name !== m.client_name && (
          <Row label="Facturé à" value={m.billed_to_name} />
        )}
        {m.client_phone && <Row label="Téléphone" value={m.client_phone} />}
        {m.incident_address && (
          <Row label="Adresse intervention" value={`${m.incident_address}${m.incident_city ? `, ${m.incident_city}` : ''}`} />
        )}
        {m.destination_address && <Row label="Destination" value={m.destination_address} />}
        {m.assigned_user?.name && <Row label="Chauffeur" value={m.assigned_user.name} />}
      </Section>

      {/* Bloc Police */}
      {(m.police_pv_number || m.officer_name || m.police_zone || m.saisie_motif_label || m.dpr_motif_label) && (
        <Section icon={<ShieldAlert size={14} />} title="Info police">
          {m.police_pv_number && <Row label="N° PV" value={<span className="font-mono">{m.police_pv_number}</span>} />}
          {m.officer_name && <Row label="Agent" value={m.officer_name} />}
          {m.police_zone && <Row label="Zone police" value={m.police_zone} />}
          {m.saisie_motif_label && <Row label="Motif saisie" value={m.saisie_motif_label} />}
          {m.dpr_motif_label && <Row label="Motif DPR" value={m.dpr_motif_label} />}
        </Section>
      )}

      {/* Bloc Saisie (réquisitoire / levée / temporaire / domaine) — consultation
          + annexion de documents directement depuis la fiche véhicule.
          Olivier 2026-06-14. Self-gated : ne s'affiche que pour police_saisie. */}
      <SaisiePanel mission={m as any} />

      {/* Bloc Parc */}
      <Section icon={<MapPin size={14} />} title="Position parc">
        {z?.depots?.name && <Row label="Parc" value={
          <span className="flex items-center gap-1">
            <Building2 size={12} className="text-brand" />
            <strong>{z.depots.name}</strong>
          </span>
        } />}
        <Row label="Zone" value={
          m.parc_zone_key ? (
            <span className="font-bold text-brand">
              {m.parc_zone_key}{z?.label && z.label !== m.parc_zone_key ? ` · ${z.label}` : ''}
            </span>
          ) : <span className="text-warning">Non placé</span>
        } />
        {m.parc_row_number != null && <Row label="Rangée" value={`R${m.parc_row_number}`} />}
        {m.parc_slot_index != null && <Row label="Emplacement" value={`E${m.parc_slot_index}`} />}
        {m.keys_digibox_slot && <Row label="Clés digibox" value={
          <span className="inline-flex items-center gap-1.5 font-mono font-bold text-warning">
            🔑 N° {m.keys_digibox_slot}
          </span>
        } />}
        <Row label="Entrée parc" value={fmtDateTime(m.parked_at) + (m.parked_at ? ` (${daysAgo(m.parked_at)} j)` : '')} />
        <Row label="Statut mission" value={<StatusBadge status={m.status} />} />
      </Section>

      {/* Bloc Tarif provisoire */}
      <Section icon={<Calculator size={14} />} title="Tarif provisoire">
        {t.amount_tvac != null ? (
          <div className="bg-brand/5 border border-brand/20 rounded-md p-3 mb-2">
            <p className="text-ink-muted text-xs">Total TVAC</p>
            <p className="font-display text-2xl font-bold text-brand">{t.amount_tvac.toFixed(2)} €</p>
            {t.htva != null && <p className="text-ink-muted text-xs">({t.htva.toFixed(2)} € HTVA)</p>}
          </div>
        ) : (
          <p className="text-ink-muted text-sm italic">Calcul provisoire non disponible.</p>
        )}
        {t.details.length > 0 && (
          <ul className="text-xs text-ink-muted space-y-0.5 list-disc list-inside">
            {t.details.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
        {m.payment_amount != null && (
          <p className="text-xs text-success mt-2">
            ✓ Déjà encaissé le {fmtDateTime(m.payment_collected_at)}
          </p>
        )}
      </Section>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-3 border-t">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={hubUrl}
            className="flex-1 min-w-[180px] flex items-center justify-center gap-1.5 px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition">
            🏷️ Restituer / Actions parc
          </Link>
          <Link href={dispatchUrl}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-lg text-sm font-semibold transition">
            <ExternalLink size={14} /> Fiche dispatch
          </Link>
        </div>
        {/* Olivier 2026-06-04 : module fourriere uniquement.
            Ouvre RestituerEtFacturerModal :
            1) Recherche client Odoo, ou creation si pas trouve (avec Google Maps)
            2) PATCH mission avec billed_to + infos client
            3) force-status to_invoice
            4) redirect /facturation?q=<num> */}
        {(userModules.includes('fourriere') || ['admin', 'superadmin'].includes(userRole)) && (
          <button
            onClick={() => setShowRestituerFacturer(true)}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition">
            <Receipt size={14} /> Restituer et facturer
          </button>
        )}
        {showRestituerFacturer && (
          <RestituerEtFacturerModal
            mission={{
              id:                     m.id,
              mission_number:         m.mission_number,
              external_id:            m.external_id,
              vehicle_plate:          m.vehicle_plate,
              source:                 m.source,
              police_blocked:         m.police_blocked,
              police_levee_saisie_ok: m.police_levee_saisie_ok,
              client_name:            m.client_name,
              client_phone:           m.client_phone,
              client_address:         m.client_address,
              billed_to_id:           m.billed_to_id,
              billed_to_name:         m.billed_to_name,
            }}
            onClose={() => setShowRestituerFacturer(false)}
            onSuccess={(q) => {
              setShowRestituerFacturer(false)
              onClose()
              router.push(`/facturation?q=${encodeURIComponent(q)}`)
            }}
          />
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={driverUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 text-ink-muted hover:text-ink text-xs transition">
            Vue chauffeur
          </Link>
          {m.odoo_vehicle_id && (
            <a href={`${process.env.NEXT_PUBLIC_ODOO_URL || ''}/web#id=${m.odoo_vehicle_id}&model=fleet.vehicle&view_type=form`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-ink-muted hover:text-ink text-xs transition">
              <ExternalLink size={12} /> Fiche véhicule Odoo
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border rounded-card p-4">
      <h3 className="flex items-center gap-1.5 text-ink font-semibold text-sm mb-2 uppercase tracking-wide">
        {icon} {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-baseline text-sm">
      <span className="text-ink-muted text-xs">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    parked:           { label: 'En parc',         cls: 'bg-info/15 text-info border-info/30' },
    delivering:       { label: 'En livraison',    cls: 'bg-warning/15 text-warning border-warning/30' },
    unlocated:        { label: 'Non localisé',    cls: 'bg-critical/15 text-critical border-critical/30' },
    awaiting_payment: { label: 'Attend paiement', cls: 'bg-warning/15 text-warning border-warning/30' },
    completed:        { label: 'Terminée',        cls: 'bg-success/15 text-success border-success/30' },
    to_invoice:       { label: 'À facturer',      cls: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
  }
  const v = map[status] || { label: status, cls: 'bg-ink/5 text-ink-muted border' }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${v.cls}`}>{v.label}</span>
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return d }
}

function daysAgo(d: string | null): number {
  if (!d) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000))
}

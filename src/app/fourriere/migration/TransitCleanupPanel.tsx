'use client'

/**
 * src/app/fourriere/migration/TransitCleanupPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * Olivier 2026-06-06 PM : UI dediee pour la zone Transit en fin de migration.
 * Liste les missions transferees automatiquement vers Transit lors du
 * "Terminer zone X" (migration_pending=true). Pour chaque ligne :
 *   - Affiche les infos vehicule (plaque, VIN, marque/modele, source, raison)
 *   - Bouton "Chercher Odoo" -> lookup factures liees
 *   - 4 actions humaines :
 *     - 🟢 Sortie avant migration -> status=completed
 *     - 🔴 Fantome / inexistant   -> status=cancelled
 *     - 🟡 A chercher Verviers    -> migration_pending_reason=search_verviers
 *     - ⚫ Marquer resolue        -> migration_pending=false (cas re-scanne ailleurs)
 *
 * Le but : a la fin du nettoyage, la liste est vide -> inventaire VD Soft propre.
 */

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, FileText, ExternalLink, Check, X, Search, MapPin } from 'lucide-react'

interface TransitMission {
  id:                       string
  mission_number:           number | null
  external_id:              string | null
  vehicle_plate:            string | null
  vehicle_vin:              string | null
  vehicle_brand:            string | null
  vehicle_model:            string | null
  client_name:              string | null
  source:                   string | null
  status:                   string
  parked_at:                string | null
  odoo_vehicle_id:          number | null
  odoo_helpdesk_id:         number | null
  migration_pending_reason: string | null
  created_at:               string
}

interface OdooOrder {
  id:               number
  name:             string
  partner_name:     string | null
  date_order:       string
  amount_total:     number
  state:            string
  invoice_status:   string
  client_order_ref: string | null
  source:           string
  odoo_url:         string
}

const REASON_LABELS: Record<string, string> = {
  not_scanned_zone_A: 'Pas scanné zone A',
  not_scanned_zone_B: 'Pas scanné zone B',
  not_scanned_zone_C: 'Pas scanné zone C',
  not_scanned_zone_D: 'Pas scanné zone D',
  not_scanned_zone_E: 'Pas scanné zone E',
  not_scanned_zone_F: 'Pas scanné zone F',
  not_scanned_zone_G: 'Pas scanné zone G',
  not_scanned_zone_H: 'Pas scanné zone H',
  not_scanned_zone_I: 'Pas scanné zone I',
  not_scanned_zone_J: 'Pas scanné zone J',
  not_scanned_zone_K: 'Pas scanné zone K',
  not_scanned_zone_L: 'Pas scanné zone L',
  search_verviers:    '🔍 À chercher Verviers',
  unknown:            'Raison inconnue',
}

export default function TransitCleanupPanel() {
  const [loading, setLoading]     = useState(true)
  const [missions, setMissions]   = useState<TransitMission[]>([])
  const [byReason, setByReason]   = useState<Record<string, TransitMission[]>>({})
  const [busy, setBusy]           = useState<string | null>(null)
  const [odooOrders, setOdooOrders] = useState<Record<string, OdooOrder[]>>({})
  const [odooLoading, setOdooLoading] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/towsoft-migration/transit-pending', { cache: 'no-store' })
      const j = await r.json()
      setMissions(j.missions || [])
      setByReason(j.by_reason || {})
    } catch (e: any) {
      console.warn('[TransitCleanup] load KO:', e?.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function checkOdoo(missionId: string) {
    setOdooLoading(missionId)
    try {
      const r = await fetch('/api/admin/towsoft-migration/check-odoo-invoices', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: missionId }),
      })
      const j = await r.json()
      if (r.ok) {
        setOdooOrders(prev => ({ ...prev, [missionId]: j.orders || [] }))
        setExpandedId(missionId)
      } else {
        alert(`Erreur Odoo : ${j.error}`)
      }
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message}`)
    } finally {
      setOdooLoading(null)
    }
  }

  async function doAction(missionId: string, action: string, label: string, askNote = false) {
    let note: string | null = null
    if (askNote) {
      note = prompt(`Note pour "${label}" ? (optionnel)`)
      if (note === null) return  // cancelled
    } else {
      if (!confirm(`Confirmer : ${label} ?`)) return
    }
    setBusy(missionId)
    try {
      const r = await fetch('/api/admin/towsoft-migration/transit-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_id: missionId, action, note }),
      })
      const j = await r.json()
      if (!r.ok) { alert(`Erreur : ${j.error}`); return }
      // Retire la ligne traitée de la liste
      setMissions(prev => prev.filter(m => m.id !== missionId))
      setByReason(prev => {
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          next[k] = next[k].filter(m => m.id !== missionId)
        }
        return next
      })
    } catch (e: any) {
      alert(`Erreur réseau : ${e?.message}`)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-surface border rounded-2xl p-6 text-center text-ink-muted">
        <Loader2 className="inline animate-spin mr-2" size={14} /> Chargement…
      </div>
    )
  }

  if (missions.length === 0) {
    return (
      <div className="bg-success-soft border border-success/30 rounded-2xl p-6 text-center">
        <div className="text-4xl mb-2">🎉</div>
        <p className="text-success font-bold text-lg">Transit vide — Inventaire VD Soft propre</p>
        <p className="text-ink-muted text-sm mt-1">Tous les véhicules ont été traités.</p>
      </div>
    )
  }

  const reasons = Object.keys(byReason).sort()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-warning-soft border border-warning/30 rounded-2xl p-4 flex items-start gap-3">
        <span className="text-2xl">🧹</span>
        <div className="flex-1">
          <h3 className="font-bold text-warning text-base">Nettoyage Transit — {missions.length} véhicule(s) à traiter</h3>
          <p className="text-ink-muted text-xs mt-1">
            Ces véhicules étaient en BDD dans des zones non scannées pendant la migration. Pour chacun, indique l'action à prendre. La liste se vide au fur et à mesure.
          </p>
        </div>
        <button onClick={load} title="Recharger" className="p-2 hover:bg-warning/10 rounded-lg">
          <RefreshCw size={14} className="text-warning" />
        </button>
      </div>

      {/* Liste par raison */}
      {reasons.map(reason => (
        <section key={reason}>
          <h4 className="text-xs font-bold text-ink-secondary uppercase mb-2">
            {REASON_LABELS[reason] || reason} ({byReason[reason].length})
          </h4>
          <div className="space-y-2">
            {byReason[reason].map(m => {
              const isExpanded = expandedId === m.id
              const orders = odooOrders[m.id] || null
              return (
                <div key={m.id} className="bg-surface border rounded-xl p-3 text-sm">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <strong className="text-ink font-mono">{m.vehicle_plate || '—'}</strong>
                        {m.mission_number && <span className="text-ink-muted text-xs">#{m.mission_number}</span>}
                        {m.source && <span className="px-1.5 py-0.5 bg-info-soft text-info text-xs rounded">{m.source}</span>}
                      </div>
                      <p className="text-ink-muted text-xs mt-0.5">
                        {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'} · VIN: {m.vehicle_vin || '—'}
                      </p>
                      {m.client_name && <p className="text-ink-muted text-xs">👤 {m.client_name}</p>}
                      {m.parked_at && (
                        <p className="text-ink-muted text-xs">📅 En parc depuis {new Date(m.parked_at).toLocaleDateString('fr-BE')}</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 items-end flex-shrink-0">
                      <button
                        onClick={() => checkOdoo(m.id)}
                        disabled={odooLoading === m.id}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-md font-medium border border-purple-200 disabled:opacity-50"
                        title="Chercher facture/devis Odoo"
                      >
                        {odooLoading === m.id ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                        Odoo {orders && `(${orders.length})`}
                      </button>
                      {m.external_id?.startsWith('TS-') && (
                        <a
                          href={`https://verviers.towsoft.ca/appel.php?num=${m.external_id.replace(/^TS-/, '')}`}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md font-medium border border-amber-200"
                        >
                          <ExternalLink size={11} /> TowSoft
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Resultats Odoo */}
                  {isExpanded && orders && (
                    <div className="mt-2 p-2 bg-surface-2 rounded-lg border text-xs">
                      {orders.length === 0 ? (
                        <p className="text-ink-muted italic">❌ Aucun devis/facture Odoo trouvé pour ce véhicule</p>
                      ) : (
                        <>
                          <p className="text-ink-secondary font-semibold mb-1">{orders.length} document(s) Odoo lié(s) :</p>
                          <ul className="space-y-1">
                            {orders.map(o => (
                              <li key={o.id} className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <span className="font-medium">{o.name}</span>
                                  <span className="text-ink-muted ml-2">{o.partner_name}</span>
                                  <span className="text-ink-muted ml-2">{o.date_order?.slice(0,10)}</span>
                                  <span className="text-ink-muted ml-2">{o.amount_total?.toFixed(2)}€</span>
                                  <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${o.invoice_status === 'invoiced' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>
                                    {o.state} · {o.invoice_status}
                                  </span>
                                </div>
                                <a href={o.odoo_url} target="_blank" rel="noopener" className="text-info hover:underline">
                                  <ExternalLink size={11} />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <button
                      onClick={() => doAction(m.id, 'sortie_avant_migration', 'Sortie avant migration', true)}
                      disabled={busy === m.id}
                      className="px-2 py-1.5 bg-success-soft hover:bg-success/20 text-success border border-success/40 rounded-md text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      title="Le véhicule est sorti légitimement avant la migration"
                    >
                      <Check size={11} /> Sortie
                    </button>
                    <button
                      onClick={() => doAction(m.id, 'search_verviers', 'À chercher au site Verviers')}
                      disabled={busy === m.id}
                      className="px-2 py-1.5 bg-warning-soft hover:bg-warning/20 text-warning border border-warning/40 rounded-md text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      title="Garder en attente, sera traité lors du scan du site Verviers"
                    >
                      <MapPin size={11} /> Verviers
                    </button>
                    <button
                      onClick={() => doAction(m.id, 'mark_resolved', 'Marquer comme résolue')}
                      disabled={busy === m.id}
                      className="px-2 py-1.5 bg-info-soft hover:bg-info/20 text-info border border-info/40 rounded-md text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      title="Sort de la liste sans changer le status (cas re-scanné ailleurs)"
                    >
                      <FileText size={11} /> Résolue
                    </button>
                    <button
                      onClick={() => doAction(m.id, 'fantome', 'Fantôme / inexistant', true)}
                      disabled={busy === m.id}
                      className="px-2 py-1.5 bg-red-50 hover:bg-red-100 text-red-800 border border-red-300 rounded-md text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      title="Le véhicule n'existe pas / fantôme TowSoft → annulée"
                    >
                      <X size={11} /> Fantôme
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

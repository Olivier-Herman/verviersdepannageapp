'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import FacturerModal from '@/components/facturation/FacturerModal'

interface MissionRow {
  id: string
  mission_number: number | null
  external_id: string | null
  dossier_number: string | null
  source: string | null
  status: string
  mission_type: string | null
  incident_type: string | null
  parent_mission_id: string | null
  client_name: string | null
  client_phone: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_vin: string | null
  incident_address: string | null
  destination_address: string | null
  received_at: string
  intervention_date: string | null
  completed_at: string | null
  amount_to_collect: number | null
  amount_collected: number | null
  payment_method: string | null
  special_tarif_htva: number | null
  assigned_to: string | null
  invoice_method: string | null
  invoice_number: string | null
  invoice_url: string | null
  no_charge_at:     string | null
  no_charge_reason: string | null
}

interface SiblingRow {
  id: string
  mission_number: number | null
  external_id: string | null
  source: string | null
  status: string
  mission_type: string | null
  incident_type: string | null
  parent_mission_id: string | null
  client_name: string | null
  vehicle_plate: string | null
  received_at: string
  completed_at: string | null
  invoice_method: string | null
  invoice_number: string | null
  no_charge_at:     string | null
  no_charge_reason: string | null
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

interface DriverRow { id: string; name: string | null }

interface AdvanceRow {
  id:          string
  mission_id:  string | null
  amount_htva: number
  plate:       string | null
  invoice_url: string | null
}

interface Props {
  missions:    MissionRow[]
  siblings:    SiblingRow[]
  payments:    PaymentRow[]
  drivers:     DriverRow[]
  advances?:   AdvanceRow[]
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

const SOURCE_LABEL: Record<string, string> = {
  touring: 'Touring', allianz: 'Allianz', vab: 'VAB',
  axa: 'AXA', ethias: 'Ethias', police: 'Police',
}
function fmtSource(s: string | null): string {
  if (!s) return '—'
  return SOURCE_LABEL[s.toLowerCase()] || s
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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

export default function FacturationClient({
  missions, siblings, payments, drivers, advances = [],
  userRole, userName, userEmail, userModules,
}: Props) {

  // Olivier 2026-06-01 : map mission_id -> avances liees, pour highlight des
  // cartes "A facturer" qui contiennent une avance de fonds (attention requise).
  const advancesByMission = useMemo(() => {
    const map = new Map<string, AdvanceRow[]>()
    for (const a of advances) {
      if (!a.mission_id) continue
      const list = map.get(a.mission_id) || []
      list.push(a)
      map.set(a.mission_id, list)
    }
    return map
  }, [advances])
  const hasAdvances = (mid: string) => (advancesByMission.get(mid)?.length || 0) > 0
  const totalAdvanceFor = (mid: string) =>
    (advancesByMission.get(mid) || []).reduce((s, a) => s + Number(a.amount_htva || 0), 0)
  const [search, setSearch]     = useState('')
  const [sourceFilter, setSrc]  = useState<string>('all')
  const [selected, setSelected] = useState<MissionRow | null>(null)
  const [data, setData]         = useState(missions)

  const driverName = useMemo(() => {
    const map = new Map<string, string>()
    drivers.forEach(d => map.set(d.id, d.name || 'Sans nom'))
    return (id: string | null) => id ? (map.get(id) || '—') : '—'
  }, [drivers])

  const paymentsByMission = useMemo(() => {
    const map = new Map<string, PaymentRow[]>()
    payments.forEach(p => {
      if (!p.mission_id) return
      const list = map.get(p.mission_id) || []
      list.push(p)
      map.set(p.mission_id, list)
    })
    return map
  }, [payments])

  const siblingsByMission = useMemo(() => {
    const byId       = new Map<string, SiblingRow>()
    const byParentId = new Map<string, SiblingRow[]>()
    siblings.forEach(s => {
      byId.set(s.id, s)
      if (s.parent_mission_id) {
        const list = byParentId.get(s.parent_mission_id) || []
        list.push(s)
        byParentId.set(s.parent_mission_id, list)
      }
    })
    return { byId, byParentId }
  }, [siblings])

  const sources = useMemo(() => {
    const set = new Set<string>()
    data.forEach(m => m.source && set.add(m.source))
    return [...set].sort()
  }, [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(m => {
      if (sourceFilter !== 'all' && m.source !== sourceFilter) return false
      if (!q) return true
      const hay = [
        m.mission_number?.toString(), m.external_id, m.dossier_number, m.client_name,
        m.vehicle_plate, m.vehicle_brand, m.vehicle_model,
        m.incident_address, m.destination_address,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [data, search, sourceFilter])

  function handleInvoiceUpdated(updated: { id: string; status: string; invoice_method?: string | null; invoice_number?: string | null; invoice_url?: string | null }[]) {
    // Retirer les fiches passees a 'completed' (= facturees)
    const completedIds = new Set(updated.filter(u => u.status === 'completed').map(u => u.id))
    setData(d => d.filter(m => !completedIds.has(m.id)))
    // Si le modal etait ouvert sur une fiche maintenant completed, le fermer
    if (selected && completedIds.has(selected.id)) setSelected(null)
  }

  return (
    <AppShell title="Facturation" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
      <div className="p-4 lg:p-6 space-y-4">

        {/* Hero header */}
        <div className="ambient-fade-up flex items-start gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-success/20 via-brand/15 to-purple-500/15 flex items-center justify-center text-2xl shadow-lg shadow-brand/10 flex-shrink-0">
            <span>🧾</span>
          </div>
          <div>
            <h1 className="text-ink text-2xl lg:text-3xl font-bold leading-tight">Facturation</h1>
            <p className="text-ink-muted text-sm mt-1">{filtered.length} mission{filtered.length > 1 ? 's' : ''} à facturer.</p>
          </div>
        </div>

        {/* Filtres */}
        <div className="bg-surface border rounded-2xl p-4 space-y-3 ambient-fade-up ambient-stagger-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Recherche (plaque, client, dossier...)"
              className="sm:col-span-2 bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand placeholder:text-ink-faint"
            />
            <select
              value={sourceFilter}
              onChange={e => setSrc(e.target.value)}
              className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
            >
              <option value="all">Toutes sources</option>
              {sources.map(s => (
                <option key={s} value={s}>{fmtSource(s)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Liste */}
        {filtered.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center">
            <p className="text-ink-muted text-sm">Aucune mission à facturer.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map(m => {
              const kind         = missionKind(m)
              const childRels    = siblingsByMission.byParentId.get(m.id) || []
              const parentRow    = m.parent_mission_id ? siblingsByMission.byId.get(m.parent_mission_id) : null
              const hasChain     = childRels.length > 0 || !!parentRow
              const pays         = paymentsByMission.get(m.id) || []
              const advs         = advancesByMission.get(m.id) || []
              const hasAdv       = advs.length > 0
              const advTotal     = advs.reduce((s, a) => s + Number(a.amount_htva || 0), 0)
              const hasSpecial   = m.special_tarif_htva != null && Number(m.special_tarif_htva) > 0

              return (
                <li key={m.id}>
                  <Link
                    href={`/dispatch/${m.id}`}
                    className={`block rounded-2xl p-4 transition flex flex-col sm:flex-row sm:items-center gap-3 relative overflow-hidden ${
                      hasSpecial
                        ? 'bg-amber-50 border-2 border-amber-500 hover:bg-amber-100 hover:border-amber-600'
                        : hasAdv
                          ? 'bg-indigo-50 border-2 border-indigo-400 hover:bg-indigo-100 hover:border-indigo-500'
                          : 'bg-surface border hover:bg-surface-hover'
                    }`}
                  >
                    {/* Ruban "Avance" en coin haut-gauche — Olivier 2026-06-01 */}
                    {hasAdv && (
                      <div className={`absolute top-0 left-0 text-white text-[10px] font-bold px-2 py-0.5 rounded-br-lg uppercase tracking-wider ${hasSpecial ? 'bg-amber-600' : 'bg-indigo-600'}`}>
                        💰 {advs.length} Avance{advs.length > 1 ? 's' : ''}
                      </div>
                    )}
                    {/* Ruban "Tarif spécial" — Olivier 2026-06-02 PM */}
                    {hasSpecial && (
                      <div className={`absolute top-0 ${hasAdv ? 'right-0 rounded-bl-lg' : 'left-0 rounded-br-lg'} bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 uppercase tracking-wider`}>
                        ⚡ Tarif spécial
                      </div>
                    )}

                    <span className={`inline-flex items-center justify-center w-12 h-12 rounded-xl text-white text-xs font-bold flex-shrink-0 ${KIND_COLOR[kind]} ${hasAdv ? 'mt-3 sm:mt-0' : ''}`}>
                      {kind}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-ink font-semibold text-sm">{m.mission_number != null ? `#${m.mission_number}` : (m.external_id || m.dossier_number || m.id.slice(0, 8))}</span>
                        <span className="text-ink-muted text-xs">·</span>
                        <span className="text-ink-secondary text-xs">{fmtSource(m.source)}</span>
                        {hasChain && (
                          <span className="ml-2 px-2 py-0.5 bg-purple-600/15 text-purple-400 text-xs rounded font-medium">
                            chaîne REM+REL
                          </span>
                        )}
                      </div>
                      <p className="text-ink-secondary text-sm mt-0.5 truncate">
                        {m.vehicle_plate ? <span className="font-mono">{m.vehicle_plate}</span> : '—'}
                        {' · '}
                        {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}
                        {' · '}
                        {m.client_name || '—'}
                      </p>
                      <p className="text-ink-muted text-xs mt-0.5">
                        Terminé le {fmtDateTime(m.completed_at)}
                      </p>
                    </div>

                    {hasAdv && (
                      <span className="px-2.5 py-1 bg-indigo-100 border-2 border-indigo-400 text-indigo-800 text-xs font-semibold rounded-lg whitespace-nowrap" title="Avances de fonds liées à ajouter au devis">
                        💰 {advTotal.toFixed(2)} € HTVA
                      </span>
                    )}
                    {hasSpecial && (
                      <span className="px-2.5 py-1 bg-amber-100 border-2 border-amber-500 text-amber-900 text-xs font-bold rounded-lg whitespace-nowrap" title="Tarif spécial HTVA — Intervention suivant prix convenu">
                        ⚡ {Number(m.special_tarif_htva).toFixed(2)} € HTVA
                      </span>
                    )}

                    {pays.length > 0 && (
                      <span className="px-2.5 py-1 bg-warning-soft border border-warning text-warning text-xs font-semibold rounded-lg whitespace-nowrap">
                        ⚠ {pays.reduce((s, p) => s + Number(p.amount || 0), 0).toFixed(2)} € encaissé
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelected(m) }}
                      className="px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold transition whitespace-nowrap flex-shrink-0"
                    >
                      Facturer →
                    </button>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      </AmbientBackground>

      {selected && (
        <FacturerModal
          mission={selected}
          siblings={[
            ...((selected.parent_mission_id && siblingsByMission.byId.get(selected.parent_mission_id)) ? [siblingsByMission.byId.get(selected.parent_mission_id)!] : []),
            ...(siblingsByMission.byParentId.get(selected.id) || []),
          ]}
          payments={paymentsByMission.get(selected.id) || []}
          driverName={driverName}
          onClose={() => setSelected(null)}
          onUpdated={handleInvoiceUpdated}
        />
      )}
    </AppShell>
  )
}

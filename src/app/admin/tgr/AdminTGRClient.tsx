// src/app/admin/tgr/AdminTGRClient.tsx
'use client'

import { useState } from 'react'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: '⏳ En attente',  color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  accepted:  { label: '✅ Acceptée',    color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30'  },
  refused:   { label: '❌ Refusée',     color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30'      },
  taken:     { label: '🤝 Reprise',     color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30'    },
  completed: { label: '✔️ Terminée',    color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/30'    },
}

const PRIORITY_OPTIONS = [
  { value: 1, label: 'P1', color: 'text-red-400' },
  { value: 2, label: 'P2', color: 'text-orange-400' },
  { value: 3, label: 'P3', color: 'text-green-400' },
]

export default function AdminTGRClient({ missions }: { missions: any[] }) {
  const [filterStatus,  setFilterStatus]  = useState('')
  const [filterPartner, setFilterPartner] = useState('')
  const [filterPeriod,  setFilterPeriod]  = useState('all')
  const [selected,      setSelected]      = useState<any | null>(null)
  const [acting,        setActing]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [plannedDate,   setPlannedDate]   = useState('')
  const [plannedSlot,   setPlannedSlot]   = useState<'before_noon'|'during_day'|'asap'>('during_day')
  const [odooResult,    setOdooResult]    = useState<{name?: string; error?: string} | null>(null)
  const [showAcceptModal, setShowAcceptModal] = useState(false)

  // Filtrage par période
  const now = new Date()
  const filtered = missions.filter(m => {
    const date = new Date(m.created_at)
    if (filterPeriod === '7d'  && (now.getTime() - date.getTime()) > 7  * 86400000) return false
    if (filterPeriod === '30d' && (now.getTime() - date.getTime()) > 30 * 86400000) return false
    if (filterStatus  && m.status !== filterStatus)               return false
    if (filterPartner && m.partner?.name !== filterPartner)       return false
    return true
  })

  // Stats
  const total      = filtered.length
  const accepted   = filtered.filter(m => m.status === 'accepted').length
  const refused    = filtered.filter(m => m.status === 'refused').length
  const taken      = filtered.filter(m => m.status === 'taken').length
  const pending    = filtered.filter(m => m.status === 'pending').length

  // Délai moyen d'acceptation (en minutes)
  const acceptedWithTime = filtered.filter(m => m.status === 'accepted' && m.accepted_at)
  const avgAcceptMin = acceptedWithTime.length > 0
    ? Math.round(acceptedWithTime.reduce((sum, m) => {
        return sum + (new Date(m.accepted_at).getTime() - new Date(m.created_at).getTime()) / 60000
      }, 0) / acceptedWithTime.length)
    : null

  // Partenaires uniques
  const partners = [...new Set(missions.map(m => m.partner?.name).filter(Boolean))]

  const doAction = async (action: 'accept' | 'refuse') => {
    if (!selected) return
    setActing(true); setError(null); setOdooResult(null)
    try {
      const res  = await fetch(`/api/tgr/${selected.id}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action,
          plannedDate: action === 'accept' ? plannedDate || undefined : undefined,
          plannedSlot: action === 'accept' ? plannedSlot : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (action === 'accept') {
        setOdooResult({ name: data.odooQuoteName, error: data.odooError })
        // Rafraîchir après 2s pour laisser voir le résultat
        setTimeout(() => {
          setShowAcceptModal(false)
          setSelected(null)
          window.location.reload()
        }, 2500)
      } else {
        setSelected(null)
        window.location.reload()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setActing(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-white font-bold text-2xl mb-1">TGR Touring</h1>
        <p className="text-zinc-500 text-sm">{total} mission{total > 1 ? 's' : ''}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total',        value: total,    color: 'text-white' },
          { label: 'En attente',   value: pending,  color: 'text-yellow-400' },
          { label: 'Acceptées',    value: accepted, color: 'text-green-400' },
          { label: 'Refusées',     value: refused,  color: 'text-red-400' },
          { label: 'Reprises',     value: taken,    color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-zinc-500 text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Délai moyen */}
      {avgAcceptMin !== null && (
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl p-4 mb-5 inline-block">
          <p className="text-white font-bold text-lg">
            {avgAcceptMin < 60
              ? `${avgAcceptMin} min`
              : `${Math.round(avgAcceptMin / 60)}h${avgAcceptMin % 60 > 0 ? ` ${avgAcceptMin % 60}min` : ''}`
            }
          </p>
          <p className="text-zinc-500 text-xs">Délai moyen d'acceptation</p>
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap gap-2 mb-5">
        <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}
          className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
          <option value="all">Toutes périodes</option>
          <option value="7d">7 derniers jours</option>
          <option value="30d">30 derniers jours</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
          <option value="">Tous statuts</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select value={filterPartner} onChange={e => setFilterPartner(e.target.value)}
          className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
          <option value="">Tous partenaires</option>
          {partners.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Tableau desktop */}
      <div className="hidden lg:block bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-[#2a2a2a]">
              <th className="text-left py-3 px-4">Référence</th>
              <th className="text-left py-3 px-4">Véhicule</th>
              <th className="text-left py-3 px-4">Trajet</th>
              <th className="text-left py-3 px-4">Demandeur</th>
              <th className="text-left py-3 px-4">Priorité</th>
              <th className="text-left py-3 px-4">Statut</th>
              <th className="text-left py-3 px-4">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-zinc-600 text-sm text-center py-8">Aucune mission</td></tr>
            )}
            {filtered.map(m => {
              const cfg = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.pending
              const pri = PRIORITY_OPTIONS.find(p => p.value === m.priority)
              return (
                <tr key={m.id} onClick={() => setSelected(m)}
                  className="border-b border-[#1e1e1e] hover:bg-[#222] cursor-pointer transition-colors">
                  <td className="py-3 px-4 text-white text-sm font-medium">{m.reference}</td>
                  <td className="py-3 px-4">
                    <p className="text-white text-sm">{m.plate}</p>
                    <p className="text-zinc-500 text-xs">{m.brand} {m.model}</p>
                  </td>
                  <td className="py-3 px-4 text-zinc-400 text-xs max-w-[200px]">
                    <p className="truncate">{m.pickup_address?.split(',')[0]}</p>
                    <p className="truncate">→ {m.delivery_address?.split(',')[0]}</p>
                    {m.distance_km && <p className="text-zinc-600">{m.distance_km} km</p>}
                  </td>
                  <td className="py-3 px-4 text-zinc-400 text-sm">{m.partner?.name}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-semibold ${pri?.color}`}>{pri?.label}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                  </td>
                  <td className="py-3 px-4 text-zinc-600 text-xs">
                    {new Date(m.created_at).toLocaleDateString('fr-BE')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Cartes mobile */}
      <div className="lg:hidden flex flex-col gap-3">
        {filtered.map(m => {
          const cfg = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.pending
          const pri = PRIORITY_OPTIONS.find(p => p.value === m.priority)
          return (
            <button key={m.id} onClick={() => setSelected(m)}
              className={`w-full bg-[#1A1A1A] border rounded-2xl p-4 text-left ${cfg.bg}`}>
              <div className="flex justify-between mb-1">
                <p className="text-white font-bold">{m.reference}</p>
                <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
              </div>
              <p className="text-zinc-400 text-sm">{m.plate} — {m.brand} {m.model}</p>
              <p className="text-zinc-600 text-xs mt-1">{m.partner?.name} · <span className={pri?.color}>{pri?.label}</span></p>
            </button>
          )
        })}
      </div>

      {/* Modal détail */}
      {selected && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end lg:items-center lg:justify-center"
          onClick={() => setSelected(null)}>
          <div className="bg-[#1A1A1A] w-full lg:max-w-lg rounded-t-3xl lg:rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-white font-bold text-lg">{selected.reference}</h2>
                <span className={`text-xs font-semibold ${STATUS_CONFIG[selected.status]?.color}`}>
                  {STATUS_CONFIG[selected.status]?.label}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-zinc-500 text-2xl">×</button>
            </div>

            <div className="space-y-2 mb-5">
              {[
                ['Demandeur',   selected.partner?.name],
                ['Véhicule',    `${selected.plate} — ${selected.brand} ${selected.model}`],
                ['État',        selected.is_rolling ? '🟢 Roulant' : '🔴 Non roulant'],
                ['Pick-up',     selected.pickup_address],
                ['Livraison',   selected.delivery_address],
                ['Distance',    selected.distance_km ? `${selected.distance_km} km` : null],
                ['Deadline',    selected.deadline_date
                  ? `${new Date(selected.deadline_date).toLocaleDateString('fr-BE')} ${selected.deadline_slot === 'before_noon' ? 'avant midi' : 'dans la journée'}`
                  : 'ASAP'],
                ['Devis Odoo',  selected.odoo_quote_name],
                ['Accepté par', selected.acceptedBy?.name],
                ['Repris par',  selected.taken_by_name],
                ['Remarques',   selected.remarks],
                ['Date',        new Date(selected.created_at).toLocaleString('fr-BE')],
              ].filter(r => r[1]).map(([label, value]) => (
                <div key={label as string} className="flex justify-between py-2 border-b border-[#2a2a2a]">
                  <span className="text-zinc-500 text-sm">{label}</span>
                  <span className="text-white text-sm text-right max-w-[60%]">{value}</span>
                </div>
              ))}
            </div>

            {error && (
              <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl p-3 text-sm mb-4">{error}</div>
            )}

            {selected.status === 'pending' && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <button onClick={() => doAction('refuse')} disabled={acting}
                    className="flex-1 py-3 bg-red-900/40 border border-red-800 text-red-300 rounded-xl font-medium text-sm disabled:opacity-50">
                    {acting ? '…' : '❌ Refuser'}
                  </button>
                  <button onClick={() => {
                    // Pré-remplir avec la deadline de la mission
                    setPlannedDate(selected.deadline_date || '')
                    setPlannedSlot(selected.deadline_slot || 'during_day')
                    setOdooResult(null)
                    setError(null)
                    setShowAcceptModal(true)
                  }} disabled={acting}
                    className="flex-1 py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                    ✅ Accepter
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ─── Modal acceptation avec date ─── */}
      {showAcceptModal && selected && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
          onClick={() => setShowAcceptModal(false)}>
          <div className="bg-[#1A1A1A] rounded-2xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-white font-bold text-lg">Accepter la mission</h2>
                <p className="text-zinc-500 text-sm mt-0.5 font-mono">{selected.reference}</p>
              </div>
              <button onClick={() => setShowAcceptModal(false)} className="text-zinc-500 text-2xl">×</button>
            </div>

            {/* Récap mission */}
            <div className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-white font-mono font-bold">{selected.plate}</span>
                <span className="text-zinc-400 text-sm">— {selected.brand} {selected.model}</span>
              </div>
              <p className="text-zinc-500 text-xs">{selected.pickup_address?.split(',')[0]} → {selected.delivery_address?.split(',')[0]}</p>
              {selected.distance_km && <p className="text-zinc-600 text-xs mt-1">{selected.distance_km} km</p>}
            </div>

            {/* Sélecteur date */}
            <div className="mb-4">
              <label className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2 block">
                📅 Date de prise en charge prévue
              </label>
              <div className="flex gap-2">
                <input type="date" value={plannedDate}
                  onChange={e => setPlannedDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="flex-1 bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-3
                             text-white text-sm outline-none focus:border-brand" />
                <select value={plannedSlot} onChange={e => setPlannedSlot(e.target.value as any)}
                  className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-3
                             text-zinc-300 text-sm outline-none appearance-none">
                  <option value="before_noon">Avant midi</option>
                  <option value="during_day">Dans la journée</option>
                  <option value="asap">Dès que possible</option>
                </select>
              </div>
              <p className="text-zinc-600 text-xs mt-1.5">
                Deadline automatique : {selected.deadline_date
                  ? new Date(selected.deadline_date).toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long' })
                  : 'ASAP'}{selected.deadline_slot === 'before_noon' ? ' avant midi' : selected.deadline_slot === 'during_day' ? ' dans la journée' : ''}
              </p>
            </div>

            {/* Résultat Odoo après confirmation */}
            {odooResult && (
              <div className={`rounded-xl px-3 py-2 text-xs mb-4 ${
                odooResult.error
                  ? 'bg-orange-950/50 border border-orange-800 text-orange-300'
                  : 'bg-green-950/50 border border-green-800 text-green-300'
              }`}>
                {odooResult.name && <p>✅ Référence créée : <strong>{odooResult.name}</strong></p>}
                {odooResult.error && <p>⚠️ Référence non créée : {odooResult.error}</p>}
              </div>
            )}

            {error && (
              <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl px-3 py-2 text-sm mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setShowAcceptModal(false)} disabled={acting}
                className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-xl font-medium text-sm disabled:opacity-50">
                Annuler
              </button>
              <button onClick={() => doAction('accept')} disabled={acting}
                className="flex-1 py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {acting ? '⏳ Confirmation…' : '✅ Confirmer et envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

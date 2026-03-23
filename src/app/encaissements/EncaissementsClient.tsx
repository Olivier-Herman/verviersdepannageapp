'use client'

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'

const PAYMENT_LABELS: Record<string, string> = {
  cash:         '💵 Espèces',
  terminal:     '💳 SumUp Terminal',
  qr:           '📱 QR Code',
  tap:          '📲 Tap to Pay',
  email:        '✉️ Lien Email',
  sumup_manual: '🔵 SumUp Manuel',
  bancontact:   '🏦 Bancontact',
  virement:     '🏦 Virement',
  card:         '💳 Carte',
  unpaid:       '📋 À facturer',
}

type EntryType = 'intervention' | 'advance'

interface Entry {
  id:             string
  type:           EntryType
  reference?:     string
  created_at:     string
  plate:          string
  brand_text?:    string
  model_text?:    string
  motif_text?:    string
  amount:         number
  payment_mode:   string
  client_name?:   string
  client_email?:  string
  synced_to_odoo?: boolean
  odoo_quote_id?:  number
  driver:         { name: string; email: string }
  notes?:         string
  invoice_url?:   string
}

export default function EncaissementsClient({
  userRole,
  userId,
}: {
  userRole: string
  userId:   string
}) {
  const [entries,      setEntries]      = useState<Entry[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [filterMode,   setFilterMode]   = useState('')
  const [filterDriver, setFilterDriver] = useState('')
  const [filterType,   setFilterType]   = useState<'' | 'intervention' | 'advance'>('')
  const [drivers,      setDrivers]      = useState<{ id: string; name: string }[]>([])
  const [selected,     setSelected]     = useState<Entry | null>(null)

  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes(userRole)

  useEffect(() => {
    fetch('/api/interventions?includeAdvances=true')
      .then(r => r.json())
      .then(data => { setEntries(data || []); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(data => setDrivers((data || []).filter((u: any) =>
        ['driver', 'admin', 'superadmin', 'dispatcher'].includes(u.role)
      )))
  }, [isAdmin])

  const filtered = entries.filter(i => {
    const q = search.toLowerCase()
    const matchSearch = !q
      || i.reference?.toLowerCase().includes(q)
      || i.plate?.toLowerCase().includes(q)
      || i.client_name?.toLowerCase().includes(q)
      || i.driver?.name?.toLowerCase().includes(q)
    const matchMode   = !filterMode   || i.payment_mode === filterMode
    const matchDriver = !filterDriver || i.driver?.name === filterDriver
    const matchType   = !filterType   || i.type === filterType
    return matchSearch && matchMode && matchDriver && matchType
  })

  const totalEncaissements = filtered.filter(e => e.type === 'intervention').reduce((s, e) => s + e.amount, 0)
  const totalAvances       = filtered.filter(e => e.type === 'advance').reduce((s, e) => s + e.amount, 0)
  const solde              = totalEncaissements - totalAvances

  const Filters = (
    <div className="flex flex-col gap-2 mt-3 lg:mt-0">
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Immat, client, référence, chauffeur…"
        className="w-full lg:max-w-sm bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-4 py-2
                   text-white text-sm outline-none focus:border-brand"
      />
      <div className="flex gap-2 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
          className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
          <option value="">Tous types</option>
          <option value="intervention">Encaissements</option>
          <option value="advance">Avances de fonds</option>
        </select>
        <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
          className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
          <option value="">Tous modes</option>
          {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {isAdmin && (
          <select value={filterDriver} onChange={e => setFilterDriver(e.target.value)}
            className="bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
            <option value="">Tous les chauffeurs</option>
            {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        )}
      </div>
    </div>
  )

  return (
    <AppShell title="Mouvements" userRole={userRole} headerExtra={Filters}>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 px-4 lg:px-8 py-4">
        <div className="bg-[#1A1A1A] rounded-xl p-3 border border-[#2a2a2a]">
          <p className="text-zinc-500 text-xs">Encaissements</p>
          <p className="text-green-400 text-lg font-bold">+{totalEncaissements.toFixed(2)} €</p>
        </div>
        <div className="bg-[#1A1A1A] rounded-xl p-3 border border-[#2a2a2a]">
          <p className="text-zinc-500 text-xs">Avances</p>
          <p className="text-red-400 text-lg font-bold">-{totalAvances.toFixed(2)} €</p>
        </div>
        <div className="bg-[#1A1A1A] rounded-xl p-3 border border-[#2a2a2a]">
          <p className="text-zinc-500 text-xs">Solde</p>
          <p className={`text-lg font-bold ${solde >= 0 ? 'text-white' : 'text-red-400'}`}>
            {solde >= 0 ? '+' : ''}{solde.toFixed(2)} €
          </p>
        </div>
      </div>

      {/* Liste */}
      <div className="px-4 lg:px-8 pb-8">
        {/* Desktop : tableau */}
        <div className="hidden lg:block">
          <table className="w-full">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-[#2a2a2a]">
                <th className="text-left py-3 pr-4">Type / Réf.</th>
                <th className="text-left py-3 pr-4">Véhicule</th>
                <th className="text-left py-3 pr-4">Client / Notes</th>
                <th className="text-left py-3 pr-4">Paiement</th>
                <th className="text-left py-3 pr-4">Chauffeur</th>
                <th className="text-left py-3 pr-4">Date</th>
                <th className="text-right py-3">Montant</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="text-zinc-500 text-sm text-center py-8">Chargement…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="text-zinc-600 text-sm text-center py-8">Aucun mouvement trouvé</td></tr>
              )}
              {filtered.map(entry => (
                <tr
                  key={`${entry.type}-${entry.id}`}
                  onClick={() => setSelected(entry)}
                  className="border-b border-[#1e1e1e] hover:bg-[#1A1A1A] cursor-pointer transition-colors"
                >
                  <td className="py-3 pr-4">
                    {entry.type === 'advance' ? (
                      <span className="text-orange-400 text-xs font-semibold bg-orange-400/10
                                       px-2 py-0.5 rounded-full border border-orange-400/20">
                        📄 Avance
                      </span>
                    ) : (
                      <span className="text-brand text-xs font-mono">{entry.reference}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-white text-sm">
                    <p className="font-medium">{entry.plate}</p>
                    {(entry.brand_text || entry.model_text) && (
                      <p className="text-zinc-500 text-xs">{entry.brand_text} {entry.model_text}</p>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-zinc-400 text-sm">
                    {entry.type === 'advance' ? (entry.notes || '—') : (entry.client_name || '—')}
                  </td>
                  <td className="py-3 pr-4 text-zinc-400 text-xs">
                    {PAYMENT_LABELS[entry.payment_mode] || entry.payment_mode}
                  </td>
                  <td className="py-3 pr-4 text-zinc-500 text-xs">{entry.driver?.name}</td>
                  <td className="py-3 pr-4 text-zinc-600 text-xs">
                    {new Date(entry.created_at).toLocaleDateString('fr-BE')}
                  </td>
                  <td className={`py-3 text-right font-bold ${
                    entry.type === 'advance' ? 'text-red-400' : 'text-green-400'
                  }`}>
                    {entry.type === 'advance' ? '-' : '+'}{entry.amount?.toFixed(2)} €
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile : cartes */}
        <div className="lg:hidden">
          {loading && <p className="text-zinc-500 text-sm text-center py-8">Chargement…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-zinc-600 text-sm text-center py-8">Aucun mouvement trouvé</p>
          )}
          {filtered.map(entry => (
            <button
              key={`${entry.type}-${entry.id}`}
              onClick={() => setSelected(entry)}
              className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-2
                         text-left hover:border-brand transition-all"
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {entry.type === 'advance' ? (
                      <span className="text-orange-400 text-xs font-semibold bg-orange-400/10
                                       px-2 py-0.5 rounded-full border border-orange-400/20">
                        📄 Avance
                      </span>
                    ) : (
                      <span className="text-brand text-xs font-mono">{entry.reference}</span>
                    )}
                  </div>
                  <p className="text-white font-semibold text-sm truncate">
                    {entry.plate}
                    {(entry.brand_text || entry.model_text) && (
                      <span className="text-zinc-400 font-normal"> — {entry.brand_text} {entry.model_text}</span>
                    )}
                  </p>
                </div>
                <p className={`font-bold ml-3 flex-shrink-0 ${entry.type === 'advance' ? 'text-red-400' : 'text-green-400'}`}>
                  {entry.type === 'advance' ? '-' : '+'}{entry.amount?.toFixed(2)} €
                </p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-zinc-500 text-xs">
                  {entry.type === 'advance' ? (entry.notes || 'Avance de fonds') : (entry.client_name || 'Client inconnu')}
                </p>
                <p className="text-zinc-600 text-xs">{PAYMENT_LABELS[entry.payment_mode] || entry.payment_mode}</p>
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-zinc-600 text-xs">{entry.driver?.name}</p>
                <p className="text-zinc-700 text-xs">{new Date(entry.created_at).toLocaleDateString('fr-BE')}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Modal détail */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end lg:items-center lg:justify-center"
          onClick={() => setSelected(null)}>
          <div className="bg-[#1A1A1A] w-full lg:w-auto lg:min-w-[480px] lg:max-w-lg
                          rounded-t-3xl lg:rounded-2xl p-6 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-white font-bold text-lg">
                  {selected.type === 'advance' ? 'Avance de fonds' : selected.reference}
                </h2>
                <p className={`font-bold text-xl ${selected.type === 'advance' ? 'text-red-400' : 'text-green-400'}`}>
                  {selected.type === 'advance' ? '-' : '+'}{selected.amount?.toFixed(2)} €
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-zinc-500 text-2xl">×</button>
            </div>

            {selected.type === 'advance' && selected.invoice_url && (
              <div className="mb-4 rounded-xl overflow-hidden border border-[#2a2a2a]">
                <img src={selected.invoice_url} alt="Facture"
                  className="w-full max-h-64 object-contain bg-[#0F0F0F]" />
              </div>
            )}

            {[
              ['Type',      selected.type === 'advance' ? '📄 Avance de fonds' : '💳 Encaissement'],
              ['Véhicule',  `${selected.plate}${selected.brand_text ? ` — ${selected.brand_text} ${selected.model_text}` : ''}`],
              ['Motif',     selected.motif_text],
              ['Paiement',  PAYMENT_LABELS[selected.payment_mode] || selected.payment_mode],
              ['Client',    selected.client_name],
              ['Email',     selected.client_email],
              ['Chauffeur', selected.driver?.name],
              ['Notes',     selected.notes],
              ['Date',      new Date(selected.created_at).toLocaleString('fr-BE')],
            ].filter(r => r[1]).map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-[#2a2a2a]">
                <span className="text-zinc-500 text-sm">{label}</span>
                <span className="text-white text-sm text-right max-w-[60%]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  )
}

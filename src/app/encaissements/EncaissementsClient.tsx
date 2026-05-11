'use client'

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import { formatEur } from '@/lib/format'

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

type EntryType = 'intervention' | 'advance' | 'odoo_payment' | 'transfer_out' | 'transfer_in'

interface Entry {
  id:             string
  type:           EntryType
  reference?:     string
  created_at:     string
  plate?:         string
  brand_text?:    string
  model_text?:    string
  motif_text?:    string
  amount:         number
  payment_mode:   string
  client_name?:    string
  client_email?:   string
  client_address?: string
  synced_to_odoo?: boolean
  odoo_quote_id?:  number
  driver:         { name: string; email: string }
  notes?:         string
  invoice_url?:   string
  // Paiements Odoo (encaissements directs encodés au bureau, sync via cron)
  odoo_payment_id?: number
  odoo_status?:    'pending' | 'confirmed' | null
}

export default function EncaissementsClient({
  userRole,
  userId,
  userName    = '',
  userModules = [],
}: {
  userRole:     string
  userId:       string
  userName?:    string
  userModules?: string[]
}) {
  const [entries,      setEntries]      = useState<Entry[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [filterMode,   setFilterMode]   = useState('')
  const [filterDriver, setFilterDriver] = useState('')
  const [filterType,   setFilterType]   = useState<'' | EntryType | 'transfer'>('')
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
    // filterType 'transfer' = matche les 2 sens (out + in)
    const matchType   = !filterType
      || i.type === filterType
      || (filterType === 'transfer' && (i.type === 'transfer_out' || i.type === 'transfer_in'))
    return matchSearch && matchMode && matchDriver && matchType
  })

  const totalEncaissements = filtered.filter(e => e.type === 'intervention').reduce((s, e) => s + e.amount, 0)
  const totalOdoo          = filtered.filter(e => e.type === 'odoo_payment').reduce((s, e) => s + e.amount, 0)
  const totalAvances       = filtered.filter(e => e.type === 'advance').reduce((s, e) => s + e.amount, 0)
  const totalTransfersIn   = filtered.filter(e => e.type === 'transfer_in').reduce((s, e) => s + e.amount, 0)
  const totalTransfersOut  = filtered.filter(e => e.type === 'transfer_out').reduce((s, e) => s + e.amount, 0)
  const solde              = totalEncaissements + totalOdoo + totalTransfersIn - totalAvances - totalTransfersOut

  const Filters = (
    <div className="flex flex-col gap-2 mt-3 lg:mt-0">
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Immat, client, référence, chauffeur…"
        className="w-full lg:max-w-sm bg-surface border border rounded-xl px-4 py-2
                   text-ink text-sm outline-none focus:border-brand"
      />
      <div className="flex gap-2 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
          className="bg-surface border border rounded-xl px-3 py-2 text-ink-muted text-xs outline-none appearance-none">
          <option value="">Tous types</option>
          <option value="intervention">Encaissements app</option>
          <option value="odoo_payment">Encaissements Odoo</option>
          <option value="advance">Avances de fonds</option>
          <option value="transfer">Transferts</option>
        </select>
        <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
          className="bg-surface border border rounded-xl px-3 py-2 text-ink-muted text-xs outline-none appearance-none">
          <option value="">Tous modes</option>
          {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {isAdmin && (
          <select value={filterDriver} onChange={e => setFilterDriver(e.target.value)}
            className="bg-surface border border rounded-xl px-3 py-2 text-ink-muted text-xs outline-none appearance-none">
            <option value="">Tous les chauffeurs</option>
            {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        )}
      </div>
    </div>
  )

  return (
    <AppShell title="Mouvements" userRole={userRole} userName={userName} userModules={userModules} headerExtra={Filters}>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 px-4 lg:px-8 py-4">
        <div className="bg-surface-2 rounded-xl p-3 border border">
          <p className="text-ink-muted text-xs">Encaissements app</p>
          <p className="text-success text-lg font-bold">+{formatEur(totalEncaissements)}</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-3 border border">
          <p className="text-ink-muted text-xs">Encaissements Odoo</p>
          <p className="text-success text-lg font-bold">+{formatEur(totalOdoo)}</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-3 border border">
          <p className="text-ink-muted text-xs">Avances</p>
          <p className="text-critical text-lg font-bold">-{formatEur(totalAvances)}</p>
        </div>
        <div className="bg-surface-2 rounded-xl p-3 border border">
          <p className="text-ink-muted text-xs">Solde</p>
          <p className={`text-lg font-bold ${solde >= 0 ? 'text-ink' : 'text-critical'}`}>
            {solde >= 0 ? '+' : ''}{formatEur(solde)}
          </p>
        </div>
      </div>

      {/* Liste */}
      <div className="px-4 lg:px-8 pb-8">
        {/* Desktop : tableau */}
        <div className="hidden lg:block">
          <table className="w-full">
            <thead>
              <tr className="text-ink-muted text-xs uppercase tracking-wider border-b border">
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
                <tr><td colSpan={7} className="text-ink-muted text-sm text-center py-8">Chargement…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="text-ink-faint text-sm text-center py-8">Aucun mouvement trouvé</td></tr>
              )}
              {filtered.map(entry => (
                <tr
                  key={`${entry.type}-${entry.id}`}
                  onClick={() => setSelected(entry)}
                  className="border-b border hover:bg-surface-2 cursor-pointer transition-colors"
                >
                  <td className="py-3 pr-4">
                    {entry.type === 'advance' ? (
                      <span className="text-warning text-xs font-semibold bg-warning-soft
                                       px-2 py-0.5 rounded-full border border-warning/30">
                        📄 Avance
                      </span>
                    ) : entry.type === 'odoo_payment' ? (
                      <span className="text-info text-xs font-semibold bg-info-soft
                                       px-2 py-0.5 rounded-full border border-info/30">
                        🏦 Odoo {entry.odoo_status === 'pending' ? '⏳' : ''}
                      </span>
                    ) : entry.type === 'transfer_out' ? (
                      <span className="text-critical text-xs font-semibold bg-critical-soft
                                       px-2 py-0.5 rounded-full border border-critical/30">
                        📤 Transfert sortant
                      </span>
                    ) : entry.type === 'transfer_in' ? (
                      <span className="text-success text-xs font-semibold bg-success-soft
                                       px-2 py-0.5 rounded-full border border-success/30">
                        📥 Transfert entrant
                      </span>
                    ) : (
                      <span className="text-brand text-xs font-mono">{entry.reference}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-ink text-sm">
                    <p className="font-medium">{entry.plate || '—'}</p>
                    {(entry.brand_text || entry.model_text) && (
                      <p className="text-ink-muted text-xs">{entry.brand_text} {entry.model_text}</p>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-ink-muted text-sm">
                    {entry.type === 'advance'                         ? (entry.notes || '—')
                    : entry.type === 'odoo_payment'                   ? (entry.notes || 'Sans facture')
                    : entry.type === 'transfer_out' || entry.type === 'transfer_in' ? (entry.notes || '—')
                    :                                                   (entry.client_name || '—')}
                  </td>
                  <td className="py-3 pr-4 text-ink-muted text-xs">
                    {PAYMENT_LABELS[entry.payment_mode] || entry.payment_mode}
                  </td>
                  <td className="py-3 pr-4 text-ink-muted text-xs">{entry.driver?.name}</td>
                  <td className="py-3 pr-4 text-ink-faint text-xs">
                    {new Date(entry.created_at).toLocaleDateString('fr-BE')}
                  </td>
                  <td className={`py-3 text-right font-bold ${
                    (entry.type === 'advance' || entry.type === 'transfer_out') ? 'text-critical' : 'text-success'
                  }`}>
                    {(entry.type === 'advance' || entry.type === 'transfer_out') ? '-' : '+'}{formatEur(entry.amount || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile : cartes */}
        <div className="lg:hidden">
          {loading && <p className="text-ink-muted text-sm text-center py-8">Chargement…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-ink-faint text-sm text-center py-8">Aucun mouvement trouvé</p>
          )}
          {filtered.map(entry => (
            <button
              key={`${entry.type}-${entry.id}`}
              onClick={() => setSelected(entry)}
              className="w-full bg-surface-2 border border rounded-2xl p-4 mb-2
                         text-left hover:border-brand transition-all"
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {entry.type === 'advance' ? (
                      <span className="text-warning text-xs font-semibold bg-warning-soft
                                       px-2 py-0.5 rounded-full border border-warning/30">
                        📄 Avance
                      </span>
                    ) : entry.type === 'odoo_payment' ? (
                      <span className="text-info text-xs font-semibold bg-info-soft
                                       px-2 py-0.5 rounded-full border border-info/30">
                        🏦 Odoo {entry.odoo_status === 'pending' ? '⏳' : ''}
                      </span>
                    ) : entry.type === 'transfer_out' ? (
                      <span className="text-critical text-xs font-semibold bg-critical-soft
                                       px-2 py-0.5 rounded-full border border-critical/30">
                        📤 Transfert
                      </span>
                    ) : entry.type === 'transfer_in' ? (
                      <span className="text-success text-xs font-semibold bg-success-soft
                                       px-2 py-0.5 rounded-full border border-success/30">
                        📥 Transfert
                      </span>
                    ) : (
                      <span className="text-brand text-xs font-mono">{entry.reference}</span>
                    )}
                  </div>
                  <p className="text-ink font-semibold text-sm truncate">
                    {entry.type === 'transfer_out' || entry.type === 'transfer_in'
                      ? (entry.notes || '—')
                      : (entry.plate || (entry.type === 'odoo_payment' ? (entry.notes || 'Sans facture') : '—'))}
                    {(entry.brand_text || entry.model_text) && (
                      <span className="text-ink-muted font-normal"> — {entry.brand_text} {entry.model_text}</span>
                    )}
                  </p>
                </div>
                <p className={`font-bold ml-3 flex-shrink-0 ${(entry.type === 'advance' || entry.type === 'transfer_out') ? 'text-critical' : 'text-success'}`}>
                  {(entry.type === 'advance' || entry.type === 'transfer_out') ? '-' : '+'}{formatEur(entry.amount || 0)}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-ink-muted text-xs">
                  {entry.type === 'advance'      ? (entry.notes || 'Avance de fonds')
                  : entry.type === 'odoo_payment' ? (entry.notes || 'Paiement Odoo sans facture')
                  :                                 (entry.client_name || 'Client inconnu')}
                </p>
                <p className="text-ink-faint text-xs">{PAYMENT_LABELS[entry.payment_mode] || entry.payment_mode}</p>
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-ink-faint text-xs">{entry.driver?.name}</p>
                <p className="text-ink-faint text-xs">{new Date(entry.created_at).toLocaleDateString('fr-BE')}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Modal détail */}
      {selected && (
        <div className="fixed inset-0 bg-ink/70 z-50 flex items-end lg:items-center lg:justify-center"
          onClick={() => setSelected(null)}>
          <div className="bg-surface-2 w-full lg:w-auto lg:min-w-[480px] lg:max-w-lg
                          rounded-t-3xl lg:rounded-2xl p-6 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-ink font-bold text-lg">
                  {selected.type === 'advance'                                ? 'Avance de fonds'
                  : selected.type === 'odoo_payment'                          ? `Paiement Odoo${selected.notes ? ' — ' + selected.notes : ''}`
                  : selected.type === 'transfer_out'                          ? '📤 Transfert sortant'
                  : selected.type === 'transfer_in'                           ? '📥 Transfert entrant'
                  :                                                             selected.reference}
                </h2>
                <p className={`font-bold text-xl ${(selected.type === 'advance' || selected.type === 'transfer_out') ? 'text-critical' : 'text-success'}`}>
                  {(selected.type === 'advance' || selected.type === 'transfer_out') ? '-' : '+'}{formatEur(selected.amount || 0)}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-ink-muted text-2xl">×</button>
            </div>

            {selected.type === 'advance' && selected.invoice_url && (
              <div className="mb-4 rounded-xl overflow-hidden border border">
                <img src={selected.invoice_url} alt="Facture"
                  className="w-full max-h-64 object-contain bg-surface" />
              </div>
            )}

            {[
              ['Type',      selected.type === 'advance'                          ? '📄 Avance de fonds'
                          : selected.type === 'odoo_payment'                     ? `🏦 Encaissement Odoo${selected.odoo_status === 'pending' ? ' (en cours de traitement)' : ''}`
                          : selected.type === 'transfer_out'                     ? '📤 Transfert vers un collègue'
                          : selected.type === 'transfer_in'                      ? '📥 Transfert reçu d\'un collègue'
                          :                                                        '💳 Encaissement'],
              ['Détails',   (selected.type === 'transfer_out' || selected.type === 'transfer_in') ? (selected.notes || null) : null],
              ['Référence Odoo', selected.type === 'odoo_payment' ? selected.notes : null],
              ['Véhicule',  selected.plate ? `${selected.plate}${selected.brand_text ? ` — ${selected.brand_text} ${selected.model_text}` : ''}` : null],
              ['Motif',     selected.motif_text],
              ['Paiement',  PAYMENT_LABELS[selected.payment_mode] || selected.payment_mode],
              ['Client',    selected.client_name],
              ['Adresse',   selected.client_address],
              ['Email',     selected.client_email],
              ['Chauffeur', selected.driver?.name],
              ['Notes',     selected.type === 'odoo_payment' ? null : selected.notes],
              ['Date',      new Date(selected.created_at).toLocaleString('fr-BE')],
            ].filter(r => r[1]).map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border">
                <span className="text-ink-muted text-sm">{label}</span>
                <span className="text-ink text-sm text-right max-w-[60%]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  )
}

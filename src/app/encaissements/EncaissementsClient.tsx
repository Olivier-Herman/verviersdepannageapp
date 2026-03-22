'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const PAYMENT_LABELS: Record<string, string> = {
  cash: '💵 Espèces',
  terminal: '💳 SumUp Terminal',
  qr: '📱 QR Code',
  tap: '📲 Tap to Pay',
  email: '✉️ Lien Email',
  sumup_manual: '🔵 SumUp Manuel',
  bancontact: '🏦 Bancontact',
  unpaid: '📋 À facturer',
}

interface Intervention {
  id: string
  reference: string
  created_at: string
  plate: string
  brand_text: string
  model_text: string
  motif_text: string
  amount: number
  payment_mode: string
  client_name: string
  client_email: string
  synced_to_odoo: boolean
  driver: { name: string; email: string }
}

export default function EncaissementsClient({ userRole, userId }: { userRole: string; userId: string }) {
  const [interventions, setInterventions] = useState<Intervention[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState('')
  const [filterDriver, setFilterDriver] = useState('')
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<Intervention | null>(null)

  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes(userRole)

  useEffect(() => {
    fetch('/api/interventions')
      .then(r => r.json())
      .then(data => { setInterventions(data || []); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(data => setDrivers((data || []).filter((u: any) => u.role === 'driver')))
  }, [isAdmin])

  const filtered = interventions.filter(i => {
    const q = search.toLowerCase()
    const matchSearch = !q || i.reference?.toLowerCase().includes(q)
      || i.plate?.toLowerCase().includes(q)
      || i.client_name?.toLowerCase().includes(q)
    const matchMode = !filterMode || i.payment_mode === filterMode
    const matchDriver = !filterDriver || i.driver?.name === filterDriver
    return matchSearch && matchMode && matchDriver
  })

  const totalAmount = filtered.reduce((s, i) => s + (i.amount || 0), 0)

  return (
    <div className="min-h-screen bg-[#0F0F0F] max-w-md mx-auto flex flex-col">
      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/dashboard" className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</Link>
          <Link href="/dashboard" className="flex-1 flex justify-center">
            <img src="/logo.jpg" alt="VD" className="h-8 w-auto object-contain" />
          </Link>
          <div className="w-10" />
        </div>
        <h1 className="text-white font-bold text-lg mb-3">Encaissements</h1>

        {/* Filtres */}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Recherche immat, client, référence…"
          className="w-full bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-2" />

        <div className="flex gap-2">
          <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
            className="flex-1 bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
            <option value="">Tous modes</option>
            {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {isAdmin && (
            <select value={filterDriver} onChange={e => setFilterDriver(e.target.value)}
              className="flex-1 bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-3 py-2 text-zinc-400 text-xs outline-none appearance-none">
              <option value="">Tous chauffeurs</option>
              {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 px-5 py-3">
        <div className="bg-[#1A1A1A] rounded-xl p-3 border border-[#2a2a2a]">
          <p className="text-zinc-500 text-xs">Interventions</p>
          <p className="text-white text-xl font-bold">{filtered.length}</p>
        </div>
        <div className="bg-[#1A1A1A] rounded-xl p-3 border border-[#2a2a2a]">
          <p className="text-zinc-500 text-xs">Total TVAC</p>
          <p className="text-brand text-xl font-bold">{totalAmount.toFixed(2)} €</p>
        </div>
      </div>

      {/* Liste */}
      <div className="flex-1 px-5 pb-6 overflow-y-auto">
        {loading && <p className="text-zinc-500 text-sm text-center py-8">Chargement…</p>}
        {!loading && filtered.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-8">Aucune intervention trouvée</p>
        )}
        {filtered.map(i => (
          <button key={i.id} onClick={() => setSelected(i)}
            className="w-full bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-2 text-left hover:border-brand transition-all active:scale-98">
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-brand text-xs font-mono">{i.reference}</p>
                <p className="text-white font-semibold text-sm">{i.plate} — {i.brand_text} {i.model_text}</p>
              </div>
              <p className="text-white font-bold">{i.amount?.toFixed(2)} €</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-zinc-500 text-xs">{i.client_name || 'Client inconnu'}</p>
              <p className="text-zinc-600 text-xs">{PAYMENT_LABELS[i.payment_mode] || i.payment_mode}</p>
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-zinc-600 text-xs">{i.driver?.name}</p>
              <div className="flex items-center gap-1">
                {i.synced_to_odoo
                  ? <span className="text-green-500 text-xs">✓ Odoo</span>
                  : <span className="text-zinc-700 text-xs">Odoo en attente</span>
                }
                <span className="text-zinc-700 text-xs ml-1">
                  {new Date(i.created_at).toLocaleDateString('fr-BE')}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Détail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={() => setSelected(null)}>
          <div className="bg-[#1A1A1A] w-full rounded-t-3xl p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-lg">{selected.reference}</h2>
              <button onClick={() => setSelected(null)} className="text-zinc-500 text-2xl">×</button>
            </div>
            {[
              ['Véhicule', `${selected.plate} — ${selected.brand_text} ${selected.model_text}`],
              ['Motif', selected.motif_text],
              ['Montant', `${selected.amount?.toFixed(2)} € TVAC`],
              ['Paiement', PAYMENT_LABELS[selected.payment_mode] || selected.payment_mode],
              ['Client', selected.client_name],
              ['Email', selected.client_email],
              ['Chauffeur', selected.driver?.name],
              ['Date', new Date(selected.created_at).toLocaleString('fr-BE')],
              ['Odoo', selected.synced_to_odoo ? '✓ Synchronisé' : '⏳ En attente'],
            ].filter(r => r[1]).map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-[#2a2a2a]">
                <span className="text-zinc-500 text-sm">{label}</span>
                <span className="text-white text-sm text-right max-w-[60%]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

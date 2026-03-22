'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Entry {
  id: string
  amount: number
  type: 'encaissement' | 'remise' | 'reception'
  notes: string
  created_at: string
  verified_at: string | null
  driver: { name: string; email: string }
  verifier: { name: string } | null
}

interface Driver {
  id: string
  name: string
  email: string
  role: string
}

export default function AdminCashClient({ drivers, entries }: { drivers: Driver[]; entries: Entry[] }) {
  const [selectedDriver, setSelectedDriver] = useState('')

  // Calculer le solde par personne
  const balances = drivers.map(driver => {
    const driverEntries = entries.filter(e => e.driver?.email === driver.email)
    const balance = driverEntries.reduce((sum, e) => {
      if (e.type === 'encaissement') return sum + e.amount
      if (e.type === 'remise') return sum - e.amount
      if (e.type === 'reception') return sum + e.amount
      return sum
    }, 0)
    return { ...driver, balance: Math.round(balance * 100) / 100 }
  }).filter(d => d.balance !== 0 || entries.some(e => e.driver?.email === d.email))

  const totalCash = balances.reduce((sum, d) => sum + Math.max(0, d.balance), 0)

  const filteredEntries = selectedDriver
    ? entries.filter(e => e.driver?.email === selectedDriver)
    : entries

  return (
    <div className="min-h-screen bg-[#0F0F0F] max-w-2xl mx-auto flex flex-col">
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</Link>
          <Link href="/dashboard" className="flex-1 flex justify-center">
            <img src="/logo.jpg" alt="VD" className="h-8 w-auto object-contain" />
          </Link>
          <div className="w-10" />
        </div>
        <h1 className="text-white font-bold text-lg">Vue caisses — Administration</h1>
      </div>

      <div className="flex-1 px-5 py-6">
        {/* Total espèces en circulation */}
        <div className="bg-brand/10 border border-brand/30 rounded-2xl p-5 text-center mb-6">
          <p className="text-zinc-400 text-sm mb-1">Total espèces en circulation</p>
          <p className="text-brand text-4xl font-bold">{totalCash.toFixed(2)} €</p>
        </div>

        {/* Soldes par personne */}
        <h3 className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-3">Solde par personne</h3>
        <div className="flex flex-col gap-2 mb-6">
          {balances.map(d => (
            <button key={d.id}
              onClick={() => setSelectedDriver(selectedDriver === d.email ? '' : d.email)}
              className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${selectedDriver === d.email ? 'border-brand bg-brand/10' : 'border-[#2a2a2a] bg-[#1A1A1A] hover:border-zinc-600'}`}>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">{d.name}</p>
                <p className="text-zinc-500 text-xs">{d.role}</p>
              </div>
              <p className={`font-bold text-lg ${d.balance > 0 ? 'text-green-400' : d.balance < 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                {d.balance > 0 ? '+' : ''}{d.balance.toFixed(2)} €
              </p>
            </button>
          ))}
        </div>

        {/* Historique */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-zinc-400 text-xs font-medium uppercase tracking-wider">
            Historique {selectedDriver ? `— ${balances.find(d => d.email === selectedDriver)?.name}` : 'complet'}
          </h3>
          {selectedDriver && (
            <button onClick={() => setSelectedDriver('')} className="text-zinc-600 text-xs hover:text-white">
              Voir tout
            </button>
          )}
        </div>

        {filteredEntries.map(e => (
          <div key={e.id} className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl p-3 mb-2">
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-white text-sm font-semibold">{e.driver?.name}</p>
                <p className={`text-xs font-medium ${e.type === 'encaissement' ? 'text-green-400' : e.type === 'reception' ? 'text-blue-400' : 'text-red-400'}`}>
                  {e.type === 'encaissement' ? '+ Encaissement espèces' : e.type === 'reception' ? '↓ Réception' : '↑ Transfert'}
                </p>
              </div>
              <p className={`font-bold ${e.type === 'encaissement' || e.type === 'reception' ? 'text-green-400' : 'text-red-400'}`}>
                {e.type === 'remise' ? '-' : '+'}{e.amount.toFixed(2)} €
              </p>
            </div>
            {e.notes && e.type !== 'encaissement' && (
              <p className="text-zinc-500 text-xs leading-relaxed">{e.notes}</p>
            )}
            <p className="text-zinc-700 text-xs mt-1">
              {new Date(e.created_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

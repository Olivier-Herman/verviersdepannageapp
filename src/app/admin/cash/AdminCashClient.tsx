'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatEur } from '@/lib/format'

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
    <div className="min-h-screen bg-surface max-w-2xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <Link href="/dashboard" className="flex-1 flex justify-center">
            <img src="/logo.jpg" alt="VD" className="h-8 w-auto object-contain" />
          </Link>
          <div className="w-10" />
        </div>
        <h1 className="text-ink font-bold text-lg">Vue caisses — Administration</h1>
      </div>

      <div className="flex-1 px-5 py-6">
        {/* Total espèces en circulation */}
        <div className="bg-brand/10 border border-brand/30 rounded-2xl p-5 text-center mb-6">
          <p className="text-ink-muted text-sm mb-1">Total espèces en circulation</p>
          <p className="text-brand text-4xl font-bold">{formatEur(totalCash)}</p>
        </div>

        {/* Soldes par personne */}
        <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wider mb-3">Solde par personne</h3>
        <div className="flex flex-col gap-2 mb-6">
          {balances.map(d => (
            <button key={d.id}
              onClick={() => setSelectedDriver(selectedDriver === d.email ? '' : d.email)}
              className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${selectedDriver === d.email ? 'border-brand bg-brand/10' : 'border bg-surface-2 hover:border-zinc-600'}`}>
              <div className="text-left">
                <p className="text-ink font-semibold text-sm">{d.name}</p>
                <p className="text-ink-muted text-xs">{d.role}</p>
              </div>
              <p className={`font-bold text-lg ${d.balance > 0 ? 'text-success' : d.balance < 0 ? 'text-critical' : 'text-ink-faint'}`}>
                {d.balance > 0 ? '+' : ''}{formatEur(d.balance)}
              </p>
            </button>
          ))}
        </div>

        {/* Historique */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wider">
            Historique {selectedDriver ? `— ${balances.find(d => d.email === selectedDriver)?.name}` : 'complet'}
          </h3>
          {selectedDriver && (
            <button onClick={() => setSelectedDriver('')} className="text-ink-faint text-xs hover:text-ink">
              Voir tout
            </button>
          )}
        </div>

        {filteredEntries.map(e => (
          <div key={e.id} className="bg-surface-2 border border rounded-xl p-3 mb-2">
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-ink text-sm font-semibold">{e.driver?.name}</p>
                <p className={`text-xs font-medium ${e.type === 'encaissement' ? 'text-success' : e.type === 'reception' ? 'text-info' : 'text-critical'}`}>
                  {e.type === 'encaissement' ? '+ Encaissement espèces' : e.type === 'reception' ? '↓ Réception' : '↑ Transfert'}
                </p>
              </div>
              <p className={`font-bold ${e.type === 'encaissement' || e.type === 'reception' ? 'text-success' : 'text-critical'}`}>
                {e.type === 'remise' ? '-' : '+'}{formatEur(e.amount)}
              </p>
            </div>
            {e.notes && e.type !== 'encaissement' && (
              <p className="text-ink-muted text-xs leading-relaxed">{e.notes}</p>
            )}
            <p className="text-ink-faint text-xs mt-1">
              {new Date(e.created_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

export default function AdminCashClient({ drivers, entries, userRole }: {
  drivers: Driver[]
  entries: Entry[]
  userRole?: string
}) {
  const router = useRouter()
  const isSuperadmin = userRole === 'superadmin'
  const [selectedDriver, setSelectedDriver] = useState('')

  // Modal ajustement caisse — superadmin uniquement
  const [adjustTarget, setAdjustTarget] = useState<{ id: string; name: string; balance: number } | null>(null)
  const [adjAmount, setAdjAmount] = useState<string>('')
  const [adjNotes,  setAdjNotes]  = useState<string>('')
  const [adjBusy,   setAdjBusy]   = useState(false)
  const [adjError,  setAdjError]  = useState<string | null>(null)

  function openAdjust(d: { id: string; name: string; balance: number }) {
    setAdjustTarget(d)
    setAdjAmount('')
    setAdjNotes('')
    setAdjError(null)
  }
  function prefillZero() {
    if (!adjustTarget) return
    // Pour ramener a 0 : montant inverse du solde actuel
    setAdjAmount(String(-adjustTarget.balance))
    if (!adjNotes) setAdjNotes(`Remise à zéro de la caisse — ${new Date().toLocaleDateString('fr-BE')}`)
  }
  async function submitAdjust() {
    if (!adjustTarget) return
    const amt = parseFloat(adjAmount.replace(',', '.'))
    if (!Number.isFinite(amt) || amt === 0) {
      setAdjError('Montant requis (positif ou négatif, non nul)')
      return
    }
    if (adjNotes.trim().length < 4) {
      setAdjError('Motif obligatoire (min 4 caractères)')
      return
    }
    setAdjBusy(true); setAdjError(null)
    try {
      const r = await fetch('/api/admin/cash-adjust', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          user_id: adjustTarget.id,
          amount:  amt,
          notes:   adjNotes.trim(),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setAdjustTarget(null)
      router.refresh()
    } catch (e: any) {
      setAdjError(e.message)
    } finally {
      setAdjBusy(false)
    }
  }

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
            <div key={d.id} className={`flex items-stretch rounded-2xl border overflow-hidden transition-all ${selectedDriver === d.email ? 'border-brand bg-brand/10' : 'border bg-surface-2 hover:border-zinc-600'}`}>
              <button
                onClick={() => setSelectedDriver(selectedDriver === d.email ? '' : d.email)}
                className="flex items-center justify-between p-4 flex-1 text-left"
              >
                <div>
                  <p className="text-ink font-semibold text-sm">{d.name}</p>
                  <p className="text-ink-muted text-xs">{d.role}</p>
                </div>
                <p className={`font-bold text-lg ${d.balance > 0 ? 'text-success' : d.balance < 0 ? 'text-critical' : 'text-ink-faint'}`}>
                  {d.balance > 0 ? '+' : ''}{formatEur(d.balance)}
                </p>
              </button>
              {isSuperadmin && (
                <button
                  onClick={() => openAdjust({ id: d.id, name: d.name, balance: d.balance })}
                  title="Ajuster la caisse (superadmin)"
                  className="px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 border-l border-amber-500/30 font-semibold text-xs"
                >
                  ⚙ Ajuster
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Modal ajustement caisse — superadmin */}
        {adjustTarget && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4">
            <div className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div>
                <h3 className="text-ink font-bold text-base">⚙ Ajuster la caisse</h3>
                <p className="text-ink-muted text-xs mt-1">
                  {adjustTarget.name} · Solde actuel : <span className={adjustTarget.balance > 0 ? 'text-success font-semibold' : adjustTarget.balance < 0 ? 'text-critical font-semibold' : 'text-ink-faint'}>{adjustTarget.balance > 0 ? '+' : ''}{formatEur(adjustTarget.balance)}</span>
                </p>
              </div>

              {adjustTarget.balance !== 0 && (
                <button
                  type="button"
                  onClick={prefillZero}
                  className="w-full py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-700 rounded-xl text-xs font-semibold"
                >
                  🎯 Remettre à zéro (montant = {-adjustTarget.balance > 0 ? '+' : ''}{(-adjustTarget.balance).toFixed(2)} €)
                </button>
              )}

              <div>
                <label className="block text-ink-secondary text-xs font-semibold mb-1.5">
                  Montant (€) — positif = crédit (+), négatif = débit (−)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={adjAmount}
                  onChange={e => setAdjAmount(e.target.value)}
                  placeholder="Ex: 50 ou -25.50"
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                />
              </div>

              <div>
                <label className="block text-ink-secondary text-xs font-semibold mb-1.5">
                  Motif obligatoire (min 4 caractères)
                </label>
                <textarea
                  value={adjNotes}
                  onChange={e => setAdjNotes(e.target.value)}
                  rows={2}
                  placeholder="Ex: Erreur de saisie, correction inventaire, Initialisation, etc."
                  className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand resize-none"
                />
                <p className="text-ink-faint text-[10px] mt-1">{adjNotes.trim().length}/4 caractères min</p>
              </div>

              {adjError && <p className="text-critical text-xs">⚠ {adjError}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  disabled={adjBusy}
                  className="flex-1 py-2.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={submitAdjust}
                  disabled={adjBusy || !adjAmount || adjNotes.trim().length < 4}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-bold"
                >
                  {adjBusy ? '⏳ ...' : 'Appliquer'}
                </button>
              </div>
            </div>
          </div>
        )}

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

        {filteredEntries.map(e => {
          const isAdjustment = e.notes?.startsWith('⚙ Ajustement superadmin')
          const labelOverride = isAdjustment
            ? (e.type === 'encaissement' ? '⚙ Ajustement (+)' : '⚙ Ajustement (−)')
            : null
          return (
          <div key={e.id} className={`border rounded-xl p-3 mb-2 ${isAdjustment ? 'bg-amber-500/10 border-amber-500/30' : 'bg-surface-2 border'}`}>
            <div className="flex items-start justify-between mb-1">
              <div>
                <p className="text-ink text-sm font-semibold">{e.driver?.name}</p>
                <p className={`text-xs font-medium ${
                  isAdjustment ? 'text-amber-600'
                  : e.type === 'encaissement' ? 'text-success'
                  : e.type === 'reception' ? 'text-info'
                  : 'text-critical'
                }`}>
                  {labelOverride || (e.type === 'encaissement' ? '+ Encaissement espèces' : e.type === 'reception' ? '↓ Réception' : '↑ Transfert')}
                </p>
              </div>
              <p className={`font-bold ${
                isAdjustment ? 'text-amber-600'
                : (e.type === 'encaissement' || e.type === 'reception') ? 'text-success'
                : 'text-critical'
              }`}>
                {e.type === 'remise' ? '-' : '+'}{formatEur(e.amount)}
              </p>
            </div>
            {/* Olivier 2026-06-01 : motif TOUJOURS affiché (y compris pour encaissement)
                pour garantir la traçabilité des ajustements superadmin. */}
            {e.notes && (
              <p className="text-ink-muted text-xs leading-relaxed">{e.notes}</p>
            )}
            <p className="text-ink-faint text-xs mt-1">
              {new Date(e.created_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          )
        })}
      </div>
    </div>
  )
}

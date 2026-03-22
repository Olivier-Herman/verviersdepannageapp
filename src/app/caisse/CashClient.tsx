'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface CashEntry {
  id: string
  amount: number
  type: 'encaissement' | 'remise'
  verified_at: string | null
  notes: string
  created_at: string
  intervention: { reference: string; plate: string; amount: number; created_at: string } | null
}

export default function CashClient({ userName }: { userName: string }) {
  const [balance, setBalance] = useState(0)
  const [entries, setEntries] = useState<CashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showRemise, setShowRemise] = useState(false)
  const [remiseAmount, setRemiseAmount] = useState('')
  const [pin, setPin] = useState('')
  const [remiseLoading, setRemiseLoading] = useState(false)
  const [remiseError, setRemiseError] = useState('')
  const [remiseSuccess, setRemiseSuccess] = useState('')

  const loadData = () => {
    setLoading(true)
    fetch('/api/cash')
      .then(r => r.json())
      .then(data => {
        setBalance(data.balance || 0)
        setEntries(data.entries || [])
        setLoading(false)
      })
  }

  useEffect(() => { loadData() }, [])

  const handleRemise = async () => {
    if (!remiseAmount || parseFloat(remiseAmount) <= 0) { setRemiseError('Montant invalide'); return }
    if (!pin || pin.length !== 4) { setRemiseError('PIN à 4 chiffres requis'); return }
    if (parseFloat(remiseAmount) > balance) { setRemiseError('Montant supérieur à la caisse'); return }

    setRemiseLoading(true); setRemiseError('')
    const res = await fetch('/api/cash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'remise',
        amount: parseFloat(remiseAmount),
        pin,
        notes: `Remise de ${remiseAmount}€ par ${userName}`,
      })
    })
    const data = await res.json()
    setRemiseLoading(false)

    if (!res.ok) {
      setRemiseError(data.error === 'PIN incorrect' ? '❌ PIN incorrect' : data.error)
      return
    }

    setRemiseSuccess(`✅ Remise de ${remiseAmount}€ validée par ${data.validatedBy}`)
    setShowRemise(false)
    setRemiseAmount(''); setPin('')
    loadData()
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] max-w-md mx-auto flex flex-col">
      {/* Header */}
      <div className="bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/dashboard" className="w-10 h-10 flex items-center justify-center bg-[#2a2a2a] rounded-xl text-white text-lg">←</Link>
          <Link href="/dashboard" className="flex-1 flex justify-center">
            <img src="/logo.jpg" alt="VD" className="h-8 w-auto object-contain" />
          </Link>
          <div className="w-10" />
        </div>
        <h1 className="text-white font-bold text-lg">Ma Caisse</h1>
      </div>

      <div className="flex-1 px-5 py-6">
        {/* Solde */}
        <div className={`rounded-2xl p-6 text-center mb-6 ${balance > 0 ? 'bg-brand/10 border border-brand/30' : 'bg-[#1A1A1A] border border-[#2a2a2a]'}`}>
          <p className="text-zinc-400 text-sm mb-1">Solde en caisse</p>
          <p className={`text-4xl font-bold ${balance > 0 ? 'text-brand' : 'text-white'}`}>
            {balance.toFixed(2)} €
          </p>
          <p className="text-zinc-600 text-xs mt-1">{userName}</p>
        </div>

        {/* Succès remise */}
        {remiseSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
            {remiseSuccess}
          </div>
        )}

        {/* Bouton remise */}
        {balance > 0 && !showRemise && (
          <button onClick={() => setShowRemise(true)}
            className="w-full bg-brand text-white font-bold rounded-2xl py-4 mb-6 active:scale-95 transition-all">
            💰 Remise de l'argent à un responsable
          </button>
        )}

        {/* Formulaire remise */}
        {showRemise && (
          <div className="bg-[#1A1A1A] border border-brand/30 rounded-2xl p-5 mb-6">
            <h3 className="text-white font-bold mb-4">Remise d'espèces</h3>
            <p className="text-zinc-400 text-xs mb-3">Solde disponible : <span className="text-brand font-bold">{balance.toFixed(2)} €</span></p>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Montant à remettre</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={remiseAmount}
                  onChange={e => setRemiseAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none focus:border-brand" />
                <span className="absolute right-4 top-3 text-zinc-400">€</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">PIN du responsable (4 chiffres)</label>
              <input type="password" inputMode="numeric" maxLength={4} value={pin}
                onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="••••"
                className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3 text-white text-2xl font-bold text-center outline-none focus:border-brand tracking-widest" />
            </div>

            {remiseError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {remiseError}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setShowRemise(false); setRemiseError(''); setPin('') }}
                className="flex-1 bg-[#2a2a2a] text-zinc-400 rounded-xl py-3 font-medium">
                Annuler
              </button>
              <button onClick={handleRemise} disabled={remiseLoading}
                className="flex-1 bg-brand text-white rounded-xl py-3 font-bold disabled:opacity-50">
                {remiseLoading ? '…' : 'Valider'}
              </button>
            </div>
          </div>
        )}

        {/* Historique */}
        <h3 className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-3">Historique</h3>
        {loading && <p className="text-zinc-600 text-sm text-center py-4">Chargement…</p>}
        {entries.map(e => (
          <div key={e.id} className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-xl p-3 mb-2 flex items-center justify-between">
            <div>
              <p className={`text-sm font-semibold ${e.type === 'encaissement' ? 'text-green-400' : 'text-red-400'}`}>
                {e.type === 'encaissement' ? '+ Encaissement' : '− Remise'}
              </p>
              <p className="text-zinc-600 text-xs">{e.intervention?.reference || e.notes}</p>
              <p className="text-zinc-700 text-xs">{new Date(e.created_at).toLocaleDateString('fr-BE')}</p>
            </div>
            <div className="text-right">
              <p className={`font-bold ${e.type === 'encaissement' ? 'text-green-400' : 'text-red-400'}`}>
                {e.type === 'encaissement' ? '+' : '-'}{e.amount.toFixed(2)} €
              </p>
              {e.verified_at && <p className="text-zinc-700 text-xs">✓ Remis</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

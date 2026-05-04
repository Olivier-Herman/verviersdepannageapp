'use client'

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'

interface CashEntry {
  id: string
  amount: number
  type: 'encaissement' | 'remise' | 'reception'
  verified_at: string | null
  notes: string
  created_at: string
  odoo_status: 'pending' | 'confirmed' | null
  odoo_payment_id: number | null
  intervention: { reference: string; plate: string; amount: number; created_at: string } | null
}

export default function CashClient({
  userName,
  driverId,
  userRole = 'driver',
}: {
  userName:  string
  driverId:  string
  userRole?: string
}) {
  const [balance,         setBalance]         = useState(0)
  const [entries,         setEntries]         = useState<CashEntry[]>([])
  const [loading,         setLoading]         = useState(true)
  const [showRemise,      setShowRemise]      = useState(false)
  const [remiseAmount,    setRemiseAmount]    = useState('')
  const [pin,             setPin]             = useState('')
  const [remiseLoading,   setRemiseLoading]   = useState(false)
  const [remiseError,     setRemiseError]     = useState('')
  const [remiseSuccess,   setRemiseSuccess]   = useState('')
  const [verifiers,       setVerifiers]       = useState<{ id: string; name: string; hasPin: boolean }[]>([])
  const [selectedVerifier,setSelectedVerifier]= useState('')

  // Paiement divers (réservé aux users liés à Odoo)
  const [odooUserId,    setOdooUserId]    = useState<number | null>(null)
  const [showMisc,      setShowMisc]      = useState(false)
  const [miscAmount,    setMiscAmount]    = useState('')
  const [miscMotif,     setMiscMotif]     = useState('')
  const [miscLoading,   setMiscLoading]   = useState(false)
  const [miscError,     setMiscError]     = useState('')
  const [miscSuccess,   setMiscSuccess]   = useState('')

  const loadData = () => {
    setLoading(true)
    fetch('/api/cash')
      .then(r => r.json())
      .then(data => {
        setBalance(data.balance || 0)
        setEntries(data.entries || [])
        setOdooUserId(data.odoo_user_id ?? null)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetch('/api/cash?verifiers=true').then(r => r.json()).then(setVerifiers)
  }, [])

  const handleMiscIncome = async () => {
    setMiscError('')
    if (!miscAmount || parseFloat(miscAmount) <= 0) { setMiscError('Montant invalide'); return }
    if (!miscMotif.trim())                          { setMiscError('Motif requis'); return }
    if (miscMotif.length > 500)                     { setMiscError('Motif trop long (500 caractères max)'); return }

    setMiscLoading(true)
    const res  = await fetch('/api/cash', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'misc_income', amount: parseFloat(miscAmount), motif: miscMotif.trim() }),
    })
    const data = await res.json()
    setMiscLoading(false)
    if (!res.ok) { setMiscError(data.error || 'Erreur'); return }

    setMiscSuccess(`Paiement enregistré : ${parseFloat(miscAmount).toFixed(2)} €`)
    setShowMisc(false); setMiscAmount(''); setMiscMotif('')
    loadData()
    setTimeout(() => setMiscSuccess(''), 4000)
  }

  const handleRemise = async () => {
    if (!remiseAmount || parseFloat(remiseAmount) <= 0) { setRemiseError('Montant invalide'); return }
    if (!selectedVerifier)                               { setRemiseError('Sélectionne un responsable'); return }
    if (!pin || pin.length !== 4)                        { setRemiseError('PIN à 4 chiffres requis'); return }
    if (parseFloat(remiseAmount) > balance)              { setRemiseError('Montant supérieur à la caisse'); return }

    setRemiseLoading(true); setRemiseError('')
    const res  = await fetch('/api/cash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remise', amount: parseFloat(remiseAmount), driverId, verifierId: selectedVerifier, pin }),
    })
    const data = await res.json()
    setRemiseLoading(false)
    if (!res.ok) { setRemiseError(data.error); return }
    setRemiseSuccess(data.transferNote)
    setShowRemise(false); setRemiseAmount(''); setPin(''); setSelectedVerifier('')
    loadData()
  }

  return (
    <AppShell title="Ma Caisse" userRole={userRole} userName={userName}>

      <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto lg:mx-0">

        {/* Solde */}
        <div className={`rounded-2xl p-6 text-center mb-6 ${balance > 0
          ? 'bg-brand/10 border border-brand/30'
          : 'bg-[#1A1A1A] border border-[#2a2a2a]'}`}>
          <p className="text-zinc-400 text-sm mb-1">Solde en caisse</p>
          <p className={`text-5xl font-bold ${balance > 0 ? 'text-brand' : 'text-white'}`}>
            {balance.toFixed(2)} €
          </p>
          <p className="text-zinc-600 text-xs mt-2">{userName}</p>
          <button onClick={loadData} className="text-zinc-600 text-xs mt-2 hover:text-zinc-400">↻ Rafraîchir</button>
        </div>

        {remiseSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
            {remiseSuccess}
          </div>
        )}
        {miscSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
            {miscSuccess}
          </div>
        )}

        {balance > 0 && !showRemise && !showMisc && (
          <button onClick={() => setShowRemise(true)}
            className="w-full bg-brand text-white font-bold rounded-2xl py-4 mb-3 active:scale-95 transition-all">
            💸 Transférer l'argent à un responsable
          </button>
        )}

        {/* Paiement divers — réservé aux users liés à Odoo (odoo_user_id non null) */}
        {odooUserId !== null && !showRemise && !showMisc && (
          <button onClick={() => { setShowMisc(true); setMiscError('') }}
            className="w-full bg-[#1A1A1A] border border-brand/40 text-brand font-bold rounded-2xl py-4 mb-6 active:scale-95 transition-all">
            ➕ Recevoir un paiement divers
          </button>
        )}

        {showMisc && (
          <div className="bg-[#1A1A1A] border border-brand/30 rounded-2xl p-5 mb-6">
            <h3 className="text-white font-bold mb-1">Paiement divers</h3>
            <p className="text-zinc-400 text-xs mb-4">
              Ex : Rent a car, divers. Pour les paiements liés à une intervention, utilisez le module Encaissement.
            </p>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Montant reçu</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={miscAmount}
                  onChange={e => setMiscAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3
                             text-white text-2xl font-bold text-center outline-none focus:border-brand" />
                <span className="absolute right-4 top-3 text-zinc-400">€</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Motif</label>
              <textarea value={miscMotif} onChange={e => setMiscMotif(e.target.value.slice(0, 500))}
                placeholder="Ex : Rent a car — location véhicule M. Dupont"
                rows={3}
                className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3
                           text-white text-sm outline-none focus:border-brand resize-none" />
              <p className="text-zinc-600 text-[10px] mt-1 text-right">{miscMotif.length} / 500</p>
            </div>

            {miscError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {miscError}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setShowMisc(false); setMiscError(''); setMiscAmount(''); setMiscMotif('') }}
                className="flex-1 bg-[#2a2a2a] text-zinc-400 rounded-xl py-3 font-medium">
                Annuler
              </button>
              <button onClick={handleMiscIncome} disabled={miscLoading}
                className="flex-1 bg-brand text-white rounded-xl py-3 font-bold disabled:opacity-50">
                {miscLoading ? '…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}

        {showRemise && (
          <div className="bg-[#1A1A1A] border border-brand/30 rounded-2xl p-5 mb-6">
            <h3 className="text-white font-bold mb-1">Transfert vers un responsable</h3>
            <p className="text-zinc-400 text-xs mb-4">
              Solde disponible : <span className="text-brand font-bold">{balance.toFixed(2)} €</span>
            </p>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Responsable</label>
              <select value={selectedVerifier} onChange={e => { setSelectedVerifier(e.target.value); setRemiseError('') }}
                className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3
                           text-white text-sm outline-none appearance-none">
                <option value="">Sélectionner…</option>
                {verifiers.map(v => (
                  <option key={v.id} value={v.id} disabled={!v.hasPin}>
                    {v.name}{!v.hasPin ? ' (PIN non défini)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Montant à transférer</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={remiseAmount}
                  onChange={e => setRemiseAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3
                             text-white text-2xl font-bold text-center outline-none focus:border-brand" />
                <span className="absolute right-4 top-3 text-zinc-400">€</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">
                PIN de {verifiers.find(v => v.id === selectedVerifier)?.name || 'ce responsable'}
              </label>
              <input type="password" inputMode="numeric" maxLength={4} value={pin}
                onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="••••"
                className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3
                           text-white text-2xl font-bold text-center outline-none focus:border-brand tracking-widest" />
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
          <div key={e.id} className={`bg-[#1A1A1A] border rounded-xl p-3 mb-2 ${
            e.odoo_status === 'pending' ? 'border-yellow-500/40' : 'border-[#2a2a2a]'
          }`}>
            <div className="flex items-start justify-between mb-1">
              {(() => {
                const isAvance = e.type === 'remise' && e.notes?.startsWith('Avance de fonds')
                const isOdoo   = !!e.odoo_payment_id
                const label = e.type === 'encaissement'
                  ? (isOdoo ? '+ Encaissement Odoo' : '+ Encaissement espèces')
                  : e.type === 'reception' ? '↓ Réception transfert'
                  : isAvance               ? '↓ Avance de fonds'
                  :                         '↑ Transfert'
                const color = e.type === 'encaissement' ? 'text-green-400'
                  : e.type === 'reception' ? 'text-blue-400'
                  : isAvance               ? 'text-orange-400'
                  :                         'text-red-400'
                return <p className={`text-sm font-semibold ${color}`}>{label}</p>
              })()}
              <p className={`font-bold ${e.type === 'remise' ? 'text-red-400' : 'text-green-400'}`}>
                {e.type === 'remise' ? '-' : '+'}{e.amount.toFixed(2)} €
              </p>
            </div>
            {e.odoo_status === 'pending' && (
              <span className="inline-block bg-yellow-500/15 border border-yellow-500/40 text-yellow-400 text-[10px] uppercase tracking-wider font-bold rounded px-2 py-0.5 mb-1">
                ⏳ En cours de traitement
              </span>
            )}
            {e.type !== 'encaissement' && e.notes && (
              <p className="text-zinc-500 text-xs leading-relaxed">{e.notes}</p>
            )}
            {e.type === 'encaissement' && e.odoo_payment_id && e.notes && (
              <p className="text-zinc-500 text-xs leading-relaxed">{e.notes}</p>
            )}
            {e.type === 'encaissement' && !e.odoo_payment_id && e.intervention?.reference && (
              <p className="text-zinc-600 text-xs">{e.intervention.reference}</p>
            )}
            {e.type === 'encaissement' && !e.odoo_payment_id && !e.intervention?.reference && e.notes && (
              <p className="text-zinc-500 text-xs leading-relaxed">{e.notes}</p>
            )}
            <p className="text-zinc-700 text-xs mt-1">{new Date(e.created_at).toLocaleDateString('fr-BE')}</p>
          </div>
        ))}
      </div>
    </AppShell>
  )
}

'use client'

import { useState, useEffect, useMemo } from 'react'
import AppShell from '@/components/layout/AppShell'
// Pattern utilisé partout dans les Client Components du projet (MissionListClient, DriverClient...)
// — éviter d'importer depuis @/lib/supabase qui embarque next/headers (serveur uniquement).
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

interface PendingTransfer {
  id:          string
  sender_id:   string
  receiver_id: string
  amount:      number
  status:      'pending' | 'confirmed' | 'refused' | 'cancelled'
  notes:       string | null
  created_at:  string
  sender:      { name: string } | null
  receiver:    { name: string } | null
}

export default function CashClient({
  userName,
  driverId,
  userRole = 'driver',
  userModules = [],
}: {
  userName:     string
  driverId:     string
  userRole?:    string
  userModules?: string[]
}) {
  // Solde + historique
  const [balance, setBalance]     = useState(0)
  const [entries, setEntries]     = useState<CashEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [odooUserId, setOdooUserId] = useState<number | null>(null)

  // Paiement divers
  const [showMisc,    setShowMisc]    = useState(false)
  const [miscAmount,  setMiscAmount]  = useState('')
  const [miscMotif,   setMiscMotif]   = useState('')
  const [miscLoading, setMiscLoading] = useState(false)
  const [miscError,   setMiscError]   = useState('')
  const [miscSuccess, setMiscSuccess] = useState('')

  // Transferts peer-to-peer
  const [recipients,        setRecipients]        = useState<{ id: string; name: string }[]>([])
  const [showTransferForm,  setShowTransferForm]  = useState(false)
  const [transferReceiver,  setTransferReceiver]  = useState('')
  const [transferAmount,    setTransferAmount]    = useState('')
  const [transferNotes,     setTransferNotes]     = useState('')
  const [transferLoading,   setTransferLoading]   = useState(false)
  const [transferError,     setTransferError]     = useState('')
  const [transferSuccess,   setTransferSuccess]   = useState('')
  // Le transfert que JE viens d'envoyer (en attente de validation par le receveur)
  const [outgoingPending, setOutgoingPending] = useState<PendingTransfer | null>(null)
  // Les transferts qui M'attendent (je suis le receveur)
  const [incomingPending, setIncomingPending] = useState<PendingTransfer[]>([])
  // Action en cours sur un incoming (validate/refuse) — pour disable les boutons
  const [incomingLoadingId, setIncomingLoadingId] = useState<string | null>(null)

  // ── Charger solde + historique ───────────────────────────
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

  // ── Charger les pending in/out + receveurs ───────────────
  const loadTransferData = async () => {
    try {
      const [pendingRes, recipientsRes] = await Promise.all([
        fetch('/api/cash/transfer').then(r => r.json()),
        fetch('/api/cash/transfer/recipients').then(r => r.json()),
      ])
      const meId      = pendingRes.me_id
      const transfers: PendingTransfer[] = pendingRes.transfers || []
      setOutgoingPending(transfers.find(t => t.sender_id === meId) || null)
      setIncomingPending(transfers.filter(t => t.receiver_id === meId))
      setRecipients(recipientsRes.recipients || [])
    } catch (e) {
      console.error('[caisse] loadTransferData:', e)
    }
  }

  useEffect(() => {
    loadData()
    loadTransferData()
    const interval = setInterval(() => { loadData(); loadTransferData() }, 30000)
    return () => clearInterval(interval)
  }, [])

  // ── Realtime sur le transfert sortant : écran d'attente fermé dès résolution ──
  useEffect(() => {
    if (!outgoingPending) return
    const channel = sb
      .channel(`cash_transfer_${outgoingPending.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cash_transfers',
          filter: `id=eq.${outgoingPending.id}` },
        (payload: any) => {
          const newStatus = payload.new?.status
          if (newStatus && newStatus !== 'pending') {
            const recName = outgoingPending.receiver?.name || 'le receveur'
            const msg = newStatus === 'confirmed' ? `Transfert validé par ${recName}`
                      : newStatus === 'refused'   ? `Transfert refusé par ${recName}`
                      :                              'Transfert annulé'
            setTransferSuccess(msg)
            setOutgoingPending(null)
            loadData()
            loadTransferData()
            setTimeout(() => setTransferSuccess(''), 5000)
          }
        })
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [outgoingPending?.id])

  // ── Solde projeté côté formulaire de transfert ──────────
  const projectedBalance = useMemo(() => {
    const amt = parseFloat(transferAmount)
    if (!Number.isFinite(amt) || amt <= 0) return null
    return balance - amt
  }, [transferAmount, balance])

  // ── Handlers ─────────────────────────────────────────────
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

  const handleSendTransfer = async () => {
    setTransferError('')
    if (!transferReceiver)                                     { setTransferError('Sélectionne un receveur'); return }
    if (!transferAmount || parseFloat(transferAmount) <= 0)    { setTransferError('Montant invalide'); return }

    setTransferLoading(true)
    const res = await fetch('/api/cash/transfer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        receiver_id: transferReceiver,
        amount:      parseFloat(transferAmount),
        notes:       transferNotes.trim() || undefined,
      }),
    })
    const data = await res.json()
    setTransferLoading(false)
    if (!res.ok) { setTransferError(data.error || 'Erreur'); return }

    setShowTransferForm(false)
    setTransferReceiver(''); setTransferAmount(''); setTransferNotes('')
    await loadTransferData()
  }

  const handleCancelOutgoing = async () => {
    if (!outgoingPending) return
    if (!confirm('Annuler la demande de transfert ?')) return
    const res = await fetch(`/api/cash/transfer/${outgoingPending.id}/cancel`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { alert(data.error || 'Erreur'); return }
    setOutgoingPending(null)
    setTransferSuccess('Demande annulée')
    setTimeout(() => setTransferSuccess(''), 4000)
    loadTransferData()
  }

  const handleValidateIncoming = async (t: PendingTransfer) => {
    setIncomingLoadingId(t.id)
    const res = await fetch(`/api/cash/transfer/${t.id}/validate`, { method: 'POST' })
    const data = await res.json()
    setIncomingLoadingId(null)
    if (!res.ok) { alert(data.error || 'Erreur'); return }
    loadData()
    loadTransferData()
  }

  const handleRefuseIncoming = async (t: PendingTransfer) => {
    if (!confirm(`Refuser le transfert de ${Number(t.amount).toFixed(2)} € de ${t.sender?.name} ?`)) return
    setIncomingLoadingId(t.id)
    const res = await fetch(`/api/cash/transfer/${t.id}/refuse`, { method: 'POST' })
    const data = await res.json()
    setIncomingLoadingId(null)
    if (!res.ok) { alert(data.error || 'Erreur'); return }
    loadTransferData()
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <AppShell title="Ma Caisse" userRole={userRole} userName={userName} userModules={userModules}>

      <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto lg:mx-0">

        {/* Solde */}
        <div className={`rounded-2xl p-6 text-center mb-6 ${balance > 0
          ? 'bg-brand/10 border border-brand/30'
          : 'bg-[#1A1A1A] border border-[#2a2a2a]'}`}>
          <p className="text-zinc-400 text-sm mb-1">Solde en caisse</p>
          <p className={`text-5xl font-bold ${balance < 0 ? 'text-red-400' : (balance > 0 ? 'text-brand' : 'text-white')}`}>
            {balance.toFixed(2)} €
          </p>
          <p className="text-zinc-600 text-xs mt-2">{userName}</p>
          <button onClick={() => { loadData(); loadTransferData() }} className="text-zinc-600 text-xs mt-2 hover:text-zinc-400">↻ Rafraîchir</button>
        </div>

        {/* ── Bandeau transferts entrants à valider ──────── */}
        {incomingPending.map(t => (
          <div key={t.id} className="bg-blue-500/10 border border-blue-500/40 rounded-2xl p-4 mb-3">
            <p className="text-blue-300 text-sm mb-1">📥 Demande de transfert</p>
            <p className="text-white text-base">
              <b>{t.sender?.name || 'Un collègue'}</b> souhaite vous remettre <b>{Number(t.amount).toFixed(2)} €</b>
            </p>
            {t.notes && <p className="text-zinc-400 text-xs mt-1 italic">« {t.notes} »</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={() => handleRefuseIncoming(t)} disabled={incomingLoadingId === t.id}
                className="flex-1 bg-[#2a2a2a] text-zinc-300 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                Refuser
              </button>
              <button onClick={() => handleValidateIncoming(t)} disabled={incomingLoadingId === t.id}
                className="flex-1 bg-blue-500 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50">
                {incomingLoadingId === t.id ? '…' : 'Valider'}
              </button>
            </div>
          </div>
        ))}

        {/* ── Toasts ─────────────────────────────────────── */}
        {miscSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
            {miscSuccess}
          </div>
        )}
        {transferSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">
            {transferSuccess}
          </div>
        )}

        {/* ── Écran d'attente bloquant côté sender ────────── */}
        {outgoingPending && (
          <div className="bg-[#1A1A1A] border border-yellow-500/40 rounded-2xl p-5 mb-6 text-center">
            <p className="text-3xl mb-2">⏳</p>
            <p className="text-white font-semibold">
              En attente de validation par {outgoingPending.receiver?.name || 'le receveur'}
            </p>
            <p className="text-zinc-400 text-sm mt-1">
              {Number(outgoingPending.amount).toFixed(2)} €
              {outgoingPending.notes && <span className="block text-xs italic mt-1">« {outgoingPending.notes} »</span>}
            </p>
            <button onClick={handleCancelOutgoing}
              className="mt-4 bg-[#2a2a2a] text-zinc-300 rounded-xl py-2.5 px-6 text-sm font-medium">
              Annuler la demande
            </button>
          </div>
        )}

        {/* ── Boutons d'action principaux ──────────────────── */}
        {balance > 0 && !outgoingPending && !showTransferForm && !showMisc && (
          <button onClick={() => { setShowTransferForm(true); setTransferError('') }}
            className="w-full bg-brand text-white font-bold rounded-2xl py-4 mb-3 active:scale-95 transition-all">
            💸 Transférer l'argent à un collègue
          </button>
        )}

        {odooUserId !== null && !outgoingPending && !showTransferForm && !showMisc && (
          <button onClick={() => { setShowMisc(true); setMiscError('') }}
            className="w-full bg-[#1A1A1A] border border-brand/40 text-brand font-bold rounded-2xl py-4 mb-6 active:scale-95 transition-all">
            ➕ Recevoir un paiement divers
          </button>
        )}

        {/* ── Formulaire transfert ─────────────────────────── */}
        {showTransferForm && (
          <div className="bg-[#1A1A1A] border border-brand/30 rounded-2xl p-5 mb-6">
            <h3 className="text-white font-bold mb-1">Transfert vers un collègue</h3>
            <p className="text-zinc-400 text-xs mb-4">
              Le receveur recevra une notification et devra valider depuis son téléphone.
            </p>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Receveur</label>
              <select value={transferReceiver}
                onChange={e => { setTransferReceiver(e.target.value); setTransferError('') }}
                className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-4 py-3
                           text-white text-sm outline-none appearance-none">
                <option value="">Sélectionner…</option>
                {recipients.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Montant</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3
                             text-white text-2xl font-bold text-center outline-none focus:border-brand" />
                <span className="absolute right-4 top-3 text-zinc-400">€</span>
              </div>
              {projectedBalance !== null && (
                <p className="text-xs text-zinc-500 mt-2">
                  Solde actuel : <span className="text-white">{balance.toFixed(2)} €</span>
                  {' — '}
                  Solde après transfert : <span className={projectedBalance < 0 ? 'text-orange-400 font-semibold' : 'text-white'}>
                    {projectedBalance.toFixed(2)} €
                  </span>
                </p>
              )}
              {projectedBalance !== null && projectedBalance < 0 && (
                <p className="text-orange-400 text-xs mt-2 leading-relaxed">
                  ⚠️ Solde négatif après transfert. La validation déclenchera une alerte d&apos;écart de caisse.
                  Vous pouvez continuer.
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="text-zinc-400 text-xs mb-1.5 block">Notes (optionnel)</label>
              <textarea value={transferNotes}
                onChange={e => setTransferNotes(e.target.value.slice(0, 500))}
                placeholder="Ex : Caisse de fin de journée"
                rows={2}
                className="w-full bg-[#0F0F0F] border border-[#333] rounded-xl px-4 py-3
                           text-white text-sm outline-none focus:border-brand resize-none" />
            </div>

            {transferError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {transferError}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setShowTransferForm(false); setTransferError(''); setTransferReceiver(''); setTransferAmount(''); setTransferNotes('') }}
                className="flex-1 bg-[#2a2a2a] text-zinc-400 rounded-xl py-3 font-medium">
                Annuler
              </button>
              <button onClick={handleSendTransfer} disabled={transferLoading}
                className="flex-1 bg-brand text-white rounded-xl py-3 font-bold disabled:opacity-50">
                {transferLoading ? '…' : 'Envoyer la demande'}
              </button>
            </div>
          </div>
        )}

        {/* ── Formulaire paiement divers ──────────────────── */}
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

        {/* ── Historique ───────────────────────────────────── */}
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

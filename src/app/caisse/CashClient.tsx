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

  // Modal PIN pour valider un transfert incoming
  const [pinModalTransfer, setPinModalTransfer] = useState<PendingTransfer | null>(null)
  const [pinValue,         setPinValue]         = useState('')
  const [pinError,         setPinError]         = useState('')
  const [pinSubmitting,    setPinSubmitting]    = useState(false)

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

    // Refresh quand l onglet/PWA redevient visible (l user revient sur la page).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadData()
        loadTransferData()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Polling rapide 3s tant qu un transfert SORTANT est en attente.
  // Fallback si Supabase Realtime (defini plus bas) n est pas active sur
  // la table cash_transfers cote Supabase Database > Replication.
  useEffect(() => {
    if (!outgoingPending) return
    const fast = setInterval(() => { loadData(); loadTransferData() }, 3000)
    return () => clearInterval(fast)
  }, [outgoingPending?.id])

  // Polling rapide 3s aussi cote receveur quand il a un transfert ENTRANT en
  // attente (refresh la card incoming + le solde si l autre cote a annule).
  useEffect(() => {
    if (incomingPending.length === 0) return
    const fast = setInterval(() => { loadData(); loadTransferData() }, 3000)
    return () => clearInterval(fast)
  }, [incomingPending.length])

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

  // Validate ne POST plus directement — il ouvre la modal PIN.
  // Le vrai POST est dans handleValidateWithPin.
  const handleValidateIncoming = (t: PendingTransfer) => {
    setPinModalTransfer(t)
    setPinValue('')
    setPinError('')
  }

  const handleValidateWithPin = async () => {
    if (!pinModalTransfer) return
    if (pinValue.length !== 4) { setPinError('PIN à 4 chiffres requis'); return }
    setPinSubmitting(true)
    setPinError('')
    const res = await fetch(`/api/cash/transfer/${pinModalTransfer.id}/validate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin: pinValue }),
    })
    const data = await res.json()
    setPinSubmitting(false)
    if (!res.ok) {
      setPinError(data.error || 'Erreur')
      return
    }
    // Succes : ferme la modal + refresh data
    setPinModalTransfer(null)
    setPinValue('')
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

      <div className="px-4 lg:px-8 py-6 max-w-4xl mx-auto lg:mx-0">

        {/* Solde */}
        <div className={`rounded-2xl p-6 text-center mb-6 ${balance > 0
          ? 'bg-brand/10 border border-brand/30'
          : 'bg-surface border border'}`}>
          <p className="text-ink-secondary text-sm mb-1">Solde en caisse</p>
          <p className={`text-5xl font-bold ${balance < 0 ? 'text-red-400' : (balance > 0 ? 'text-brand' : 'text-ink')}`}>
            {balance.toFixed(2)} €
          </p>
          <p className="text-ink-faint text-xs mt-2">{userName}</p>
          <button onClick={() => { loadData(); loadTransferData() }} className="text-ink-faint text-xs mt-2 hover:text-ink-secondary">↻ Rafraîchir</button>
        </div>

        {/* ── Bandeau transferts entrants à valider ──────── */}
        {incomingPending.map(t => (
          <div key={t.id} className="bg-blue-500/10 border border-blue-500/40 rounded-2xl p-4 mb-3">
            <p className="text-blue-300 text-sm mb-1">📥 Demande de transfert</p>
            <p className="text-ink text-base">
              <b>{t.sender?.name || 'Un collègue'}</b> souhaite vous remettre <b>{Number(t.amount).toFixed(2)} €</b>
            </p>
            {t.notes && <p className="text-ink-secondary text-xs mt-1 italic">« {t.notes} »</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={() => handleRefuseIncoming(t)} disabled={incomingLoadingId === t.id}
                className="flex-1 bg-surface-hover text-ink-secondary rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                Refuser
              </button>
              <button onClick={() => handleValidateIncoming(t)} disabled={incomingLoadingId === t.id}
                className="flex-1 bg-blue-500 text-ink rounded-xl py-2.5 text-sm font-bold disabled:opacity-50">
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
          <div className="bg-surface border border-yellow-500/40 rounded-2xl p-5 mb-6 text-center">
            <p className="text-3xl mb-2">⏳</p>
            <p className="text-ink font-semibold">
              En attente de validation par {outgoingPending.receiver?.name || 'le receveur'}
            </p>
            <p className="text-ink-secondary text-sm mt-1">
              {Number(outgoingPending.amount).toFixed(2)} €
              {outgoingPending.notes && <span className="block text-xs italic mt-1">« {outgoingPending.notes} »</span>}
            </p>
            <button onClick={handleCancelOutgoing}
              className="mt-4 bg-surface-hover text-ink-secondary rounded-xl py-2.5 px-6 text-sm font-medium">
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
            className="w-full bg-surface border border-brand/40 text-brand font-bold rounded-2xl py-4 mb-6 active:scale-95 transition-all">
            ➕ Recevoir un paiement divers
          </button>
        )}

        {/* ── Formulaire transfert ─────────────────────────── */}
        {showTransferForm && (
          <div className="bg-surface border border-brand/30 rounded-2xl p-5 mb-6">
            <h3 className="text-ink font-bold mb-1">Transfert vers un collègue</h3>
            <p className="text-ink-secondary text-xs mb-4">
              Le receveur recevra une notification et devra valider depuis son téléphone.
            </p>

            <div className="mb-4">
              <label className="text-ink-secondary text-xs mb-1.5 block">Receveur</label>
              <select value={transferReceiver}
                onChange={e => { setTransferReceiver(e.target.value); setTransferError('') }}
                className="w-full bg-surface border border-strong focus:border-brand rounded-xl px-4 py-3
                           text-ink text-sm outline-none appearance-none">
                <option value="">Sélectionner…</option>
                {recipients.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="text-ink-secondary text-xs mb-1.5 block">Montant</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-surface border border-strong rounded-xl px-4 py-3
                             text-ink text-2xl font-bold text-center outline-none focus:border-brand" />
                <span className="absolute right-4 top-3 text-ink-secondary">€</span>
              </div>
              {projectedBalance !== null && (
                <p className="text-xs text-ink-muted mt-2">
                  Solde actuel : <span className="text-ink">{balance.toFixed(2)} €</span>
                  {' — '}
                  Solde après transfert : <span className={projectedBalance < 0 ? 'text-orange-400 font-semibold' : 'text-ink'}>
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
              <label className="text-ink-secondary text-xs mb-1.5 block">Notes (optionnel)</label>
              <textarea value={transferNotes}
                onChange={e => setTransferNotes(e.target.value.slice(0, 500))}
                placeholder="Ex : Caisse de fin de journée"
                rows={2}
                className="w-full bg-surface border border-strong rounded-xl px-4 py-3
                           text-ink text-sm outline-none focus:border-brand resize-none" />
            </div>

            {transferError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {transferError}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setShowTransferForm(false); setTransferError(''); setTransferReceiver(''); setTransferAmount(''); setTransferNotes('') }}
                className="flex-1 bg-surface-hover text-ink-secondary rounded-xl py-3 font-medium">
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
          <div className="bg-surface border border-brand/30 rounded-2xl p-5 mb-6">
            <h3 className="text-ink font-bold mb-1">Paiement divers</h3>
            <p className="text-ink-secondary text-xs mb-4">
              Ex : Rent a car, divers. Pour les paiements liés à une intervention, utilisez le module Encaissement.
            </p>

            <div className="mb-4">
              <label className="text-ink-secondary text-xs mb-1.5 block">Montant reçu</label>
              <div className="relative">
                <input type="text" inputMode="decimal" value={miscAmount}
                  onChange={e => setMiscAmount(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-surface border border-strong rounded-xl px-4 py-3
                             text-ink text-2xl font-bold text-center outline-none focus:border-brand" />
                <span className="absolute right-4 top-3 text-ink-secondary">€</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-ink-secondary text-xs mb-1.5 block">Motif</label>
              <textarea value={miscMotif} onChange={e => setMiscMotif(e.target.value.slice(0, 500))}
                placeholder="Ex : Rent a car — location véhicule M. Dupont"
                rows={3}
                className="w-full bg-surface border border-strong rounded-xl px-4 py-3
                           text-ink text-sm outline-none focus:border-brand resize-none" />
              <p className="text-ink-faint text-[10px] mt-1 text-right">{miscMotif.length} / 500</p>
            </div>

            {miscError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {miscError}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setShowMisc(false); setMiscError(''); setMiscAmount(''); setMiscMotif('') }}
                className="flex-1 bg-surface-hover text-ink-secondary rounded-xl py-3 font-medium">
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
        <h3 className="text-ink-secondary text-xs font-medium uppercase tracking-wider mb-3">Historique</h3>
        {loading && <p className="text-ink-faint text-sm text-center py-4">Chargement…</p>}
        {entries.map(e => (
          <div key={e.id} className={`bg-surface border rounded-xl p-3 mb-2 ${
            e.odoo_status === 'pending' ? 'border-yellow-500/40' : 'border'
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
              <p className="text-ink-muted text-xs leading-relaxed">{e.notes}</p>
            )}
            {e.type === 'encaissement' && e.odoo_payment_id && e.notes && (
              <p className="text-ink-muted text-xs leading-relaxed">{e.notes}</p>
            )}
            {e.type === 'encaissement' && !e.odoo_payment_id && e.intervention?.reference && (
              <p className="text-ink-faint text-xs">{e.intervention.reference}</p>
            )}
            {e.type === 'encaissement' && !e.odoo_payment_id && !e.intervention?.reference && e.notes && (
              <p className="text-ink-muted text-xs leading-relaxed">{e.notes}</p>
            )}
            <p className="text-ink-faint text-xs mt-1">{new Date(e.created_at).toLocaleDateString('fr-BE')}</p>
          </div>
        ))}
      </div>

      {/* ── Modal PIN pour valider un transfert entrant ── */}
      {pinModalTransfer && (
        <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
             onClick={() => !pinSubmitting && setPinModalTransfer(null)}>
          <div className="bg-surface rounded-2xl max-w-sm w-full p-5"
               onClick={e => e.stopPropagation()}>
            <h2 className="text-ink font-bold text-lg mb-1">Confirmer le transfert</h2>
            <p className="text-ink-muted text-sm mb-4">
              <b>{pinModalTransfer.sender?.name || 'Un collègue'}</b> souhaite vous remettre{' '}
              <b>{Number(pinModalTransfer.amount).toFixed(2)} €</b>.
              Saisis ton PIN pour confirmer la réception.
            </p>

            <input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={4}
              value={pinValue}
              onChange={e => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter' && pinValue.length === 4) handleValidateWithPin() }}
              placeholder="••••"
              className="w-full bg-surface-2 border border-strong focus:border-brand rounded-xl
                         px-4 py-4 text-ink text-3xl font-bold text-center tracking-[0.5em]
                         outline-none mb-3"
            />

            {pinError && (
              <div className="bg-critical-soft border border-critical/30 text-critical text-sm
                              rounded-xl px-3 py-2 mb-3">
                {pinError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setPinModalTransfer(null)}
                disabled={pinSubmitting}
                className="flex-1 bg-surface-hover text-ink-secondary rounded-xl py-3 font-medium disabled:opacity-50">
                Annuler
              </button>
              <button
                onClick={handleValidateWithPin}
                disabled={pinSubmitting || pinValue.length !== 4}
                className="flex-1 bg-brand text-white rounded-xl py-3 font-bold disabled:opacity-50">
                {pinSubmitting ? '…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

'use client'
// « Mission proposée » (garde de nuit, Olivier 30/09/2026). Se rafraîchit toutes les
// 8 s : si un autre chauffeur prend la mission ou si le délai passe, la page le dit
// tout de suite. Textes en français d'abord (traduction albanaise après validation).

import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import Link                    from 'next/link'

const ESCALATE_AFTER_MIN  = 4   // mêmes délais que lib/missions/market-proposals.ts
const RESERVE_TIMEOUT_MIN = 4

interface Proposal { id: string; status: string; step: 'night_first' | 'reserve'; reason: string | null; notifiedAt: string; message: string | null }
interface Mission {
  id: string; mission_number: number | null; source: string | null; mission_type: string | null; client_name: string | null
  vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null
  incident_address: string | null; incident_city: string | null; destination_address: string | null
  remarks_general: string | null; received_at: string | null
}

const hhmm = (d: Date) => d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
const TYPE: Record<string, string> = { remorquage: '🚛 Remorquage', rem: '🚛 Remorquage', depannage: '🔧 Dépannage', dsp: '🔧 Dépannage', transport: '🚐 Transport' }

export default function ProposalClient({ proposal, mission }: { proposal: Proposal | null; mission: Mission | null }) {
  const router = useRouter()
  const [status, setStatus]   = useState(proposal?.status || 'pending')
  const [message, setMessage] = useState<string | null>(proposal?.message || null)
  const [sending, setSending] = useState<'accept' | 'busy' | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Rafraîchit l'état tant que la proposition est ouverte.
  useEffect(() => {
    if (!proposal || status !== 'pending') return
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/market-proposals/${proposal.id}`, { cache: 'no-store' })
        const j = await r.json()
        if (r.ok && j.status !== 'pending') { setStatus(j.status); setMessage(j.message) }
      } catch { /* réseau : on retente au tour suivant */ }
    }, 8000)
    return () => clearInterval(t)
  }, [proposal, status])

  if (!proposal || !mission) {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <div className="bg-surface border rounded-2xl p-8 text-center space-y-3">
          <p className="text-ink font-semibold">Proposition introuvable</p>
          <p className="text-ink-muted text-sm">Elle ne t’est pas adressée, ou la mission n’existe plus.</p>
          <Link href="/missions-dispo" className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-brand text-white font-bold text-sm">Ouvrir Momo Market</Link>
        </div>
      </div>
    )
  }

  async function respond(action: 'accept' | 'busy') {
    if (sending) return
    setSending(action); setError(null)
    try {
      const r = await fetch(`/api/market-proposals/${proposal!.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Fermée entre-temps (prise par un autre, délai passé) : on affiche l'état réel.
        if (r.status === 409 || r.status === 410) { setStatus('closed'); setMessage(j.error || 'Cette mission n’est plus disponible.') }
        else setError(j.error || 'Réponse non enregistrée, réessaie.')
        return
      }
      if (action === 'accept') { router.replace(`/mission/${mission!.id}`); return }
      setStatus('busy'); setMessage(proposal!.step === 'night_first'
        ? 'C’est noté : la mission est proposée à la réserve et le dispatch est prévenu.'
        : 'C’est noté : le dispatch est prévenu qu’il doit attribuer la mission.')
    } catch {
      setError('Pas de connexion : réessaie.')
    } finally { setSending(null); setConfirmBusy(false) }
  }

  const deadline = new Date(new Date(proposal.notifiedAt).getTime() + (proposal.step === 'night_first' ? ESCALATE_AFTER_MIN : RESERVE_TIMEOUT_MIN) * 60_000)
  const vehicle  = [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')
  const type     = TYPE[(mission.mission_type || '').toLowerCase()] || '📋 Mission'
  const pending  = status === 'pending'

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      <div>
        <h1 className="text-ink font-bold text-xl">🌙 Mission proposée</h1>
        <p className="text-ink-muted text-sm mt-1">
          {proposal.step === 'night_first'
            ? 'Tu es 1er départ cette nuit : cette mission est pour toi si tu es libre.'
            : 'Tu es de réserve cette nuit : le 1er départ n’est pas disponible pour cette mission.'}
        </p>
        {proposal.step === 'reserve' && proposal.reason && (
          <p className="text-ink-secondary text-sm mt-1">{proposal.reason}.</p>
        )}
      </div>

      <div className="bg-surface border-2 border-brand/30 rounded-2xl p-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="bg-brand text-white text-xs font-bold px-2 py-0.5 rounded">{(mission.source || '—').toUpperCase()}</span>
          <span className="text-sm text-ink-secondary font-semibold">{type}</span>
          {mission.mission_number != null && <span className="text-ink-faint text-xs ml-auto font-mono">#{mission.mission_number}</span>}
        </div>
        <p className="text-ink font-bold text-base">{mission.client_name || 'Client'}</p>
        {(mission.vehicle_plate || vehicle) && (
          <p className="text-ink-secondary text-sm">
            {mission.vehicle_plate && <span className="font-mono font-bold">{mission.vehicle_plate}</span>}
            {vehicle && <span>{mission.vehicle_plate ? ' · ' : ''}{vehicle}</span>}
          </p>
        )}
        {(mission.incident_address || mission.incident_city) && (
          <p className="text-ink-muted text-sm">📍 {[mission.incident_address, mission.incident_city].filter(Boolean).join(', ')}</p>
        )}
        {mission.destination_address && <p className="text-ink-muted text-sm">🏁 {mission.destination_address}</p>}
        {mission.remarks_general && <p className="text-ink-faint text-xs italic line-clamp-3">{mission.remarks_general}</p>}
      </div>

      {pending ? (
        <div className="space-y-3">
          <button type="button" onClick={() => respond('accept')} disabled={!!sending}
            className="w-full min-h-[56px] rounded-2xl bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold text-base">
            {sending === 'accept' ? '⏳ Attribution…' : '✅ J’accepte'}
          </button>
          {!confirmBusy ? (
            <button type="button" onClick={() => setConfirmBusy(true)} disabled={!!sending}
              className="w-full min-h-[52px] rounded-2xl border-2 border-slate-300 dark:border-slate-600 bg-surface text-ink font-semibold text-sm disabled:opacity-60">
              🚨 Je suis déjà en mission
            </button>
          ) : (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {proposal.step === 'night_first'
                  ? 'La mission part chez la réserve et le dispatch est prévenu. Pendant 1 h, les prochaines missions iront aussi à la réserve (sauf si tu crées une fiche entre-temps).'
                  : 'Le dispatch est prévenu qu’il doit attribuer la mission.'}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => respond('busy')} disabled={!!sending}
                  className="flex-1 min-h-[44px] rounded-xl bg-amber-600 text-white font-semibold text-sm disabled:opacity-60">
                  {sending === 'busy' ? '⏳ Envoi…' : 'Oui, je suis en mission'}
                </button>
                <button type="button" onClick={() => setConfirmBusy(false)} disabled={!!sending}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-600 text-ink font-medium text-sm">
                  Annuler
                </button>
              </div>
            </div>
          )}
          {error && <p className="text-red-700 dark:text-red-300 text-sm bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2">⚠️ {error}</p>}
          <p className="text-ink-faint text-xs text-center">
            {proposal.step === 'night_first'
              ? `Sans réponse, la mission passe à la réserve à ${hhmm(deadline)}.`
              : `Sans réponse, le dispatch sera prévenu à ${hhmm(deadline)}.`}
            {' '}Un autre chauffeur peut aussi la prendre dans Momo Market.
          </p>
        </div>
      ) : (
        <div className="bg-surface border rounded-2xl p-5 space-y-3 text-center">
          <p className="text-ink font-semibold">{message || 'Cette proposition est fermée.'}</p>
          {status === 'accepted'
            ? <Link href={`/mission/${mission.id}`} className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-brand text-white font-bold text-sm">Ouvrir la mission</Link>
            : <Link href="/missions-dispo" className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-brand text-white font-bold text-sm">Ouvrir Momo Market</Link>}
          {status === 'timeout' && <p className="text-ink-muted text-xs">Si elle est encore libre, tu peux toujours la prendre dans Momo Market.</p>}
        </div>
      )}
    </div>
  )
}

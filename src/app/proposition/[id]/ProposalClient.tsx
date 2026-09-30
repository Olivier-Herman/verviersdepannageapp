'use client'
// « Mission proposée » (garde de nuit, Olivier 30/09/2026). Étapes du 1er départ :
//   asked       → J'accepte / Je suis déjà en mission / Rappelle-moi dans 15 min
//   ask_minutes → « Tu en as pour combien de temps ? » (pas de fiche : appel police…)
//   confirm     → estimation de son arrivée : ≤ 1 h confirmer, > 1 h appeler le client,
//                 impossible « es-tu certain ? » ; rappel 15 min toujours possible
//   client_call → il appelle le client, puis dit OK / pas OK (10 min)
//   snoozed     → rappel prévu, il peut encore accepter ou refuser
// Réserve : J'accepte / appeler le 1er départ / lui renvoyer la mission / déjà en mission.
// Se rafraîchit toutes les 8 s. Textes en français d'abord (albanais après validation).

import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import Link                    from 'next/link'

const ESCALATE_AFTER_MIN  = 4    // mêmes délais que lib/missions/market-proposals.ts
const RESERVE_TIMEOUT_MIN = 4
const CONFIRM_TIMEOUT_MIN = 3
const CLIENT_CALL_MIN     = 10
const ETA_OK_MIN          = 60

interface Eta { steps?: string[]; arrivalAt?: string | null; reason?: string | null; gps?: string }
interface Proposal {
  id: string; status: string; step: 'night_first' | 'reserve'; reason: string | null; notifiedAt: string; message: string | null; isTest?: boolean
  phase: string; phaseAt: string; etaMin: number | null; eta: Eta | null; snoozeUntil: string | null; snoozeCount: number
}
interface Mission {
  id: string; mission_number: number | null; source: string | null; mission_type: string | null; client_name: string | null
  vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null
  incident_address: string | null; incident_city: string | null; destination_address: string | null
  remarks_general: string | null; received_at: string | null; has_client_phone?: boolean
}

const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
const plus = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000)
const TYPE: Record<string, string> = { remorquage: '🚛 Remorquage', rem: '🚛 Remorquage', depannage: '🔧 Dépannage', dsp: '🔧 Dépannage', transport: '🚐 Transport' }
const MAX_SNOOZES = 1   // « Rappelle-moi dans 15 min » : une seule fois

// Position GPS au moment de la réponse (il vient d'ouvrir l'app) : natif d'abord,
// navigateur en repli, jamais bloquant (2,5 s max). Même principe que la fiche chauffeur.
async function captureGeo(): Promise<{ lat: number; lng: number } | null> {
  try {
    return await Promise.race([
      (async (): Promise<{ lat: number; lng: number } | null> => {
        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            const { Geolocation } = await import('@capacitor/geolocation')
            const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 2200 })
            return { lat: pos.coords.latitude, lng: pos.coords.longitude }
          }
        } catch { /* repli navigateur */ }
        if (typeof navigator === 'undefined' || !navigator.geolocation) return null
        return await new Promise(resolve => {
          navigator.geolocation.getCurrentPosition(
            p  => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: true, maximumAge: 30_000, timeout: 2200 },
          )
        })
      })(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2500)),
    ])
  } catch { return null }
}

const btn = {
  green:  'w-full min-h-[56px] rounded-2xl bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold text-base',
  brand:  'w-full min-h-[52px] rounded-2xl bg-brand hover:bg-brand-hover disabled:opacity-60 text-white font-bold text-sm',
  plain:  'w-full min-h-[52px] rounded-2xl border-2 border-slate-300 dark:border-slate-600 bg-surface text-ink font-semibold text-sm disabled:opacity-60',
  amber:  'w-full min-h-[48px] rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200 font-semibold text-sm disabled:opacity-60',
  small:  'min-h-[48px] rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-surface text-ink font-bold text-sm disabled:opacity-60',
}

export default function ProposalClient({ proposal, mission, first }: { proposal: Proposal | null; mission: Mission | null; first?: { name: string; phone: string | null } | null }) {
  const router = useRouter()
  const [status, setStatus]   = useState(proposal?.status || 'pending')
  const [message, setMessage] = useState<string | null>(proposal?.message || null)
  const [phase, setPhase]     = useState(proposal?.phase || 'asked')
  const [phaseAt, setPhaseAt] = useState(proposal?.phaseAt || proposal?.notifiedAt || new Date().toISOString())
  const [etaMin, setEtaMin]   = useState<number | null>(proposal?.etaMin ?? null)
  const [eta, setEta]         = useState<Eta | null>(proposal?.eta || null)
  const [snoozeUntil, setSnoozeUntil] = useState<string | null>(proposal?.snoozeUntil || null)
  const [snoozesLeft, setSnoozesLeft] = useState(MAX_SNOOZES - (proposal?.snoozeCount || 0))
  const [clientPhone, setClientPhone] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [confirmStep, setConfirmStep] = useState<string | null>(null)   // confirmation en ligne d'un bouton
  const [error, setError]     = useState<string | null>(null)

  // Rafraîchit l'état tant que la proposition est ouverte (prise par un autre, délai…).
  useEffect(() => {
    if (!proposal || status !== 'pending') return
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/market-proposals/${proposal.id}`, { cache: 'no-store' })
        const j = await r.json()
        if (!r.ok) return
        if (j.status !== 'pending') { setStatus(j.status); setMessage(j.message) }
        else if (j.phase && j.phase !== phase) router.refresh()   // ex. rappel 15 min écoulé
      } catch { /* réseau : on retente au tour suivant */ }
    }, 8000)
    return () => clearInterval(t)
  }, [proposal, status, phase, router])

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

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (sending) return
    setSending(action); setError(null)
    try {
      const needsPos = action === 'busy' || action === 'minutes'
      const pos = needsPos && !proposal!.isTest ? await captureGeo() : null
      const r = await fetch(`/api/market-proposals/${proposal!.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra, pos }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (r.status === 409 || r.status === 410) { setStatus('closed'); setMessage(j.error || 'Cette mission n’est plus disponible.') }
        else setError(j.error || 'Réponse non enregistrée, réessaie.')
        return
      }
      if (proposal!.isTest) {
        setStatus(action === 'accept' ? 'accepted' : 'busy')
        setMessage(action === 'accept'
          ? '🧪 Test réussi : en vrai, la mission t’aurait été attribuée et sa fiche se serait ouverte.'
          : '🧪 Test réussi : en vrai, l’app calculerait ton heure d’arrivée possible avant de passer à la réserve.')
        return
      }
      if (action === 'accept' || action === 'client_ok') { router.replace(`/mission/${mission!.id}`); return }
      const next = j.next || {}
      if (next.phase === 'closed') {
        setStatus('closed')
        setMessage(action === 'return_first' ? `C’est noté : la mission est renvoyée à ${first?.name || 'au 1er départ'}.`
          : proposal!.step === 'reserve' ? 'C’est noté : le dispatch est prévenu qu’il doit attribuer la mission.'
          : 'C’est noté : la mission part chez la réserve.')
        return
      }
      setPhase(next.phase); setPhaseAt(new Date().toISOString()); setConfirmStep(null)
      if ('etaMin' in next) { setEtaMin(next.etaMin ?? null); setEta({ steps: next.steps, arrivalAt: next.arrivalAt, reason: next.reason, gps: next.gps }) }
      if (next.snoozeUntil) setSnoozeUntil(next.snoozeUntil)
      if (typeof next.snoozesLeft === 'number') setSnoozesLeft(next.snoozesLeft)
      if (next.clientPhone) { setClientPhone(next.clientPhone); window.location.href = `tel:${next.clientPhone}` }
    } catch {
      setError('Pas de connexion : réessaie.')
    } finally { setSending(null) }
  }

  const vehicle  = [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')
  const type     = TYPE[(mission.mission_type || '').toLowerCase()] || '📋 Mission'
  const pending  = status === 'pending'
  const isFirst  = proposal.step === 'night_first'
  const arrival  = eta?.arrivalAt ? hhmm(eta.arrivalAt) : null
  const snoozeBtn = snoozesLeft > 0 && !proposal.isTest && (
    <button type="button" onClick={() => act('snooze')} disabled={!!sending} className={btn.plain}>
      {sending === 'snooze' ? '⏳ …' : '⏰ Rappelle-moi dans 15 min'}
    </button>
  )
  const refuse = (label: string) => confirmStep !== 'refuse' ? (
    <button type="button" onClick={() => setConfirmStep('refuse')} disabled={!!sending} className={btn.amber}>{label}</button>
  ) : (
    <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 p-3 space-y-2">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">La mission part chez la réserve et le dispatch est prévenu.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => act('confirm_busy')} disabled={!!sending} className="flex-1 min-h-[44px] rounded-xl bg-amber-600 text-white font-semibold text-sm disabled:opacity-60">{sending === 'confirm_busy' ? '⏳ Envoi…' : 'Oui, je ne peux pas'}</button>
        <button type="button" onClick={() => setConfirmStep(null)} disabled={!!sending} className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-600 text-ink font-medium text-sm">Annuler</button>
      </div>
    </div>
  )

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      {proposal.isTest && (
        <p className="rounded-xl border-2 border-violet-400 bg-violet-50 dark:bg-violet-500/10 px-3 py-2 text-sm font-semibold text-violet-900 dark:text-violet-200">
          🧪 TEST — mission fictive, rien n’est envoyé à la réserve ni au dispatch.
        </p>
      )}
      <div>
        <h1 className="text-ink font-bold text-xl">🌙 Mission proposée</h1>
        <p className="text-ink-muted text-sm mt-1">
          {isFirst
            ? 'Tu es 1er départ cette nuit : cette mission t’est proposée en premier, même si tu termines une intervention.'
            : 'Tu es de réserve cette nuit : le 1er départ ne peut pas prendre cette mission.'}
        </p>
        {proposal.reason && (!isFirst || proposal.reason.startsWith('renvoyée')) && (
          <p className="text-ink-secondary text-sm mt-1">{proposal.reason.charAt(0).toUpperCase() + proposal.reason.slice(1)}.</p>
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

      {!pending ? (
        <div className="bg-surface border rounded-2xl p-5 space-y-3 text-center">
          <p className="text-ink font-semibold">{message || 'Cette proposition est fermée.'}</p>
          {proposal.isTest
            ? <Link href="/proposition/test" className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-brand text-white font-bold text-sm">Refaire un test</Link>
            : status === 'accepted'
            ? <Link href={`/mission/${mission.id}`} className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-brand text-white font-bold text-sm">Ouvrir la mission</Link>
            : <Link href="/missions-dispo" className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-brand text-white font-bold text-sm">Ouvrir Momo Market</Link>}
          {status === 'timeout' && <p className="text-ink-muted text-xs">Si elle est encore libre, tu peux toujours la prendre dans Momo Market.</p>}
        </div>
      ) : !isFirst ? (
        /* ── Réserve ── */
        <div className="space-y-3">
          <button type="button" onClick={() => act('accept')} disabled={!!sending} className={btn.green}>{sending === 'accept' ? '⏳ Attribution…' : '✅ J’accepte'}</button>
          {first?.phone && <a href={`tel:${first.phone}`} className={`${btn.plain} flex items-center justify-center`}>📞 Appeler {first.name}</a>}
          {first && (confirmStep !== 'return' ? (
            <button type="button" onClick={() => setConfirmStep('return')} disabled={!!sending} className={btn.plain}>↩️ Renvoyer la mission à {first.name}</button>
          ) : (
            <div className="rounded-2xl border-2 border-sky-400 bg-sky-50 dark:bg-sky-500/10 p-3 space-y-2">
              <p className="text-sm font-medium text-sky-900 dark:text-sky-200">Vous en avez parlé et {first.name} peut la faire ? Elle lui est reproposée, et il doit l’accepter.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => act('return_first')} disabled={!!sending} className="flex-1 min-h-[44px] rounded-xl bg-sky-600 text-white font-semibold text-sm disabled:opacity-60">{sending === 'return_first' ? '⏳ Envoi…' : `Oui, renvoyer à ${first.name}`}</button>
                <button type="button" onClick={() => setConfirmStep(null)} disabled={!!sending} className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-600 text-ink font-medium text-sm">Annuler</button>
              </div>
            </div>
          ))}
          {confirmStep !== 'reserve_busy' ? (
            <button type="button" onClick={() => setConfirmStep('reserve_busy')} disabled={!!sending} className={btn.amber}>🚨 Je suis déjà en mission</button>
          ) : (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Le dispatch est prévenu qu’il doit attribuer la mission.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => act('busy')} disabled={!!sending} className="flex-1 min-h-[44px] rounded-xl bg-amber-600 text-white font-semibold text-sm disabled:opacity-60">{sending === 'busy' ? '⏳ Envoi…' : 'Oui, je suis en mission'}</button>
                <button type="button" onClick={() => setConfirmStep(null)} disabled={!!sending} className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-600 text-ink font-medium text-sm">Annuler</button>
              </div>
            </div>
          )}
          <p className="text-ink-faint text-xs text-center">Sans réponse, le dispatch sera prévenu à {hhmm(plus(phaseAt, RESERVE_TIMEOUT_MIN))}. Un autre chauffeur peut aussi la prendre dans Momo Market.</p>
        </div>
      ) : phase === 'ask_minutes' ? (
        /* ── Sans fiche : combien de temps ? ── */
        <div className="space-y-3">
          <p className="text-ink font-semibold">Tu en as pour combien de temps sur ton intervention ?</p>
          <div className="grid grid-cols-2 gap-2">
            {[15, 30, 45, 90].map(n => (
              <button key={n} type="button" onClick={() => act('minutes', { minutes: n })} disabled={!!sending} className={btn.small}>
                {sending === 'minutes' ? '⏳' : n === 90 ? 'Plus d’1 h' : `${n} min`}
              </button>
            ))}
          </div>
          <p className="text-ink-faint text-xs text-center">Sans réponse, la mission part chez la réserve à {hhmm(plus(phaseAt, CONFIRM_TIMEOUT_MIN))}.</p>
        </div>
      ) : phase === 'confirm' ? (
        /* ── Garde-fou : estimation ── */
        <div className="space-y-3">
          <div className={`rounded-2xl border-2 p-4 space-y-2 ${etaMin != null && etaMin <= ETA_OK_MIN ? 'border-green-500 bg-green-50 dark:bg-green-500/10' : etaMin != null ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10' : 'border-slate-300 dark:border-slate-600 bg-surface'}`}>
            {etaMin != null ? (
              <p className="text-ink font-bold">D’après nos calculs, tu pourrais être sur place vers {arrival} (≈ {etaMin >= 60 ? `${Math.floor(etaMin / 60)} h ${String(etaMin % 60).padStart(2, '0')}` : `${etaMin} min`}).</p>
            ) : (
              <p className="text-ink font-bold">Impossible d’estimer ton heure d’arrivée{eta?.reason ? ` : ${eta.reason}` : ''}. Es-tu certain de ne pas pouvoir être sur place dans l’heure ?</p>
            )}
            {!!eta?.steps?.length && (
              <ul className="text-ink-secondary text-xs list-disc pl-5 space-y-0.5">{eta.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
            )}
            {eta?.gps === 'none' && etaMin != null && <p className="text-ink-faint text-xs">Position GPS indisponible : calcul fait depuis le lieu de ta mission en cours.</p>}
          </div>
          {etaMin != null && etaMin > ETA_OK_MIN ? (
            <>
              {mission.has_client_phone && (
                <button type="button" onClick={() => act('client_call')} disabled={!!sending} className={btn.brand}>{sending === 'client_call' ? '⏳ …' : '📞 J’appelle le client pour annoncer mon délai'}</button>
              )}
              {snoozeBtn}
              {refuse('Je ne peux pas : la réserve peut la prendre')}
            </>
          ) : (
            <>
              <button type="button" onClick={() => act('accept')} disabled={!!sending} className={btn.green}>{sending === 'accept' ? '⏳ Attribution…' : `✅ Je la prends${arrival ? ` (vers ${arrival})` : ''}`}</button>
              {snoozeBtn}
              {refuse(etaMin != null ? 'Je confirme : je ne peux pas' : 'Oui, certain : je ne peux pas')}
            </>
          )}
          <p className="text-ink-faint text-xs text-center">Sans réponse, la mission part chez la réserve à {hhmm(plus(phaseAt, CONFIRM_TIMEOUT_MIN))}.</p>
        </div>
      ) : phase === 'client_call' ? (
        /* ── Appel au client ── */
        <div className="space-y-3">
          <p className="text-ink font-semibold">Annonce ton heure d’arrivée ({arrival ? `vers ${arrival}` : 'ton délai'}) au client, puis dis-nous sa réponse.</p>
          {clientPhone && <a href={`tel:${clientPhone}`} className={`${btn.plain} flex items-center justify-center`}>📞 Rappeler le client</a>}
          <button type="button" onClick={() => act('client_ok')} disabled={!!sending} className={btn.green}>{sending === 'client_ok' ? '⏳ Attribution…' : '✅ Le client est d’accord : je la prends'}</button>
          <button type="button" onClick={() => act('client_ko')} disabled={!!sending} className={btn.amber}>{sending === 'client_ko' ? '⏳ Envoi…' : '❌ Le client n’est pas d’accord : la réserve peut la prendre'}</button>
          <p className="text-ink-faint text-xs text-center">Sans réponse, la mission part chez la réserve à {hhmm(plus(phaseAt, CLIENT_CALL_MIN))}.</p>
        </div>
      ) : phase === 'snoozed' ? (
        /* ── Rappel prévu ── */
        <div className="space-y-3">
          <p className="text-ink font-semibold">C’est noté : on te repropose la mission à {snoozeUntil ? hhmm(snoozeUntil) : 'dans 15 min'}. La réserve n’est pas dérangée.</p>
          <button type="button" onClick={() => act('accept')} disabled={!!sending} className={btn.green}>{sending === 'accept' ? '⏳ Attribution…' : '✅ Finalement, je la prends'}</button>
          {refuse('Je ne pourrai pas : la réserve peut la prendre')}
        </div>
      ) : (
        /* ── Proposition ── */
        <div className="space-y-3">
          <button type="button" onClick={() => act('accept')} disabled={!!sending} className={btn.green}>{sending === 'accept' ? '⏳ Attribution…' : '✅ J’accepte'}</button>
          <button type="button" onClick={() => act('busy')} disabled={!!sending} className={btn.plain}>{sending === 'busy' ? '⏳ Calcul de ton heure d’arrivée…' : '🚨 Je suis déjà en mission'}</button>
          {snoozeBtn}
          <p className="text-ink-faint text-xs text-center">
            Sans réponse, la mission passe à la réserve à {hhmm(plus(phaseAt, ESCALATE_AFTER_MIN))}. Un autre chauffeur peut aussi la prendre dans Momo Market.
          </p>
        </div>
      )}
      {error && <p className="text-red-700 dark:text-red-300 text-sm bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-3 py-2">⚠️ {error}</p>}
    </div>
  )
}

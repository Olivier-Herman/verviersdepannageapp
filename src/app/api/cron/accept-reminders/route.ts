// src/app/api/cron/accept-reminders/route.ts
//
// Rappel d'acceptation : une mission assignée à un chauffeur mais non acceptée
// (status='assigned', accepted_at null) reçoit un rappel push au chauffeur, pour
// qu'il l'accepte. Anti-spam : 1er rappel après FIRST_DELAY_MIN, puis tous les
// INTERVAL_MIN, jusqu'à MAX_REMINDERS. Olivier 2026-06-18.
//
// Dernier rappel = APPEL TÉLÉPHONIQUE (Olivier 14/10/2026 : « 10 min grand max pour accepter ») :
// à CALL_AFTER_MIN, une seule fois par attribution, le chauffeur est appelé et entend un message
// (public/sounds/rappel-acceptation.wav, joué au décroché comme les appels de l'espace client) ; le
// dispatch est prévenu et l'appel est noté sur la fiche.

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification, sendNotificationToRoles }  from '@/lib/notifications/send'
import { withAiContext } from '@/lib/ai/usage'

const FIRST_DELAY_MIN = 3   // attendre 3 min après l'assignation avant le 1er rappel
const INTERVAL_MIN    = 5   // délai minimum entre deux rappels
const MAX_REMINDERS   = 4   // ~3 + 3×5 = jusqu'à ~18 min de relance
const CALL_AFTER_MIN  = 10  // délai maximum pour accepter : au-delà, on appelle le chauffeur

async function handleGET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const now        = Date.now()
  const assignedBefore = new Date(now - FIRST_DELAY_MIN * 60_000).toISOString()
  const remindBefore   = new Date(now - INTERVAL_MIN * 60_000).toISOString()

  // Missions assignées, non acceptées, assignées il y a > FIRST_DELAY_MIN,
  // pas encore relancées MAX fois, et dont le dernier rappel date d'> INTERVAL.
  const { data: missions, error } = await sb
    .from('incoming_missions')
    .select('id, mission_number, external_id, source, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_city, incident_address, assigned_to, accept_reminder_count')
    .eq('status', 'assigned')
    .is('accepted_at', null)
    .not('assigned_to', 'is', null)
    .lt('assigned_at', assignedBefore)
    .lt('accept_reminder_count', MAX_REMINDERS)
    .or(`accept_reminder_at.is.null,accept_reminder_at.lt.${remindBefore}`)
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let sent = 0
  for (const m of (missions || [])) {
    const mtNorm = (m.mission_type || '').toLowerCase().trim()
    const typeLabel = ['rem', 'remorquage'].includes(mtNorm) ? '🚛 Remorquage'
                    : ['dsp', 'depannage', 'reparation_place'].includes(mtNorm) ? '🔧 Dépannage'
                    : '📋 Mission'
    try {
      await sendNotification(m.assigned_to as string, 'mission_assigned_manual', {
        title:      `⏰ À accepter — ${typeLabel}`,
        body:       `Mission en attente de ton acceptation${m.incident_city ? ` à ${m.incident_city}` : ''}. Appuie sur « Accepter » pour voir le client et l'adresse.`,
        action_url: `/mission/${m.id}`,
        mission_id: m.id,
      })
      await sb.from('incoming_missions').update({
        accept_reminder_at:    new Date().toISOString(),
        accept_reminder_count: (m.accept_reminder_count || 0) + 1,
      }).eq('id', m.id)
      sent++
    } catch (e: any) {
      console.error('[accept-reminders]', m.id, e?.message)
    }
  }

  const calls = await appelsAcceptation(sb, now)

  if (sent || calls) console.log(`[accept-reminders] ${sent} rappel(s) envoyé(s), ${calls} appel(s)`)
  return NextResponse.json({ ok: true, sent, calls, checked: (missions || []).length })
}

/** Missions attribuées depuis plus de CALL_AFTER_MIN et toujours pas acceptées : un appel au chauffeur. */
async function appelsAcceptation(sb: ReturnType<typeof createAdminClient>, now: number): Promise<number> {
  const { data: rows, error } = await sb
    .from('incoming_missions')
    .select('id, mission_number, incident_city, vehicle_plate, assigned_to, assigned_at')
    .eq('status', 'assigned')
    .is('accepted_at', null)
    .is('accept_call_at', null)
    .not('assigned_to', 'is', null)
    .lt('assigned_at', new Date(now - CALL_AFTER_MIN * 60_000).toISOString())
    // Une attribution vieille de plus de 2 h n'est plus un oubli à rattraper par téléphone.
    .gt('assigned_at', new Date(now - 120 * 60_000).toISOString())
    .limit(20)
  if (error) throw new Error(`Appels d'acceptation : ${error.message}`)   // un cron en échec doit se voir
  let calls = 0
  for (const m of rows || []) {
    // Réservation d'abord : deux passages du cron ne doivent jamais appeler deux fois.
    const stamp = new Date().toISOString()
    const { data: pris } = await sb.from('incoming_missions').update({ accept_call_at: stamp })
      .eq('id', m.id).is('accept_call_at', null).select('id').maybeSingle()
    if (!pris) continue
    const { data: u } = await sb.from('users').select('name, phone, active').eq('id', m.assigned_to as string).maybeSingle()
    if ((u as any)?.active === false) continue
    let phone = (u as any)?.phone || null
    if (!phone) {
      const { data: p } = await sb.from('personnel').select('phone').eq('user_id', m.assigned_to as string).maybeSingle()
      phone = (p as any)?.phone || null
    }
    const { toE164 } = await import('@/lib/missions/market-proposals')
    const e164 = toE164(phone)
    let ok = false, detail = ''
    if (!e164) detail = 'pas de numéro de téléphone exploitable'
    else {
      const { initiatePstnCall } = await import('@/lib/teams/call')
      const r = await initiatePstnCall({ toPhone: e164, toDisplayName: (u as any)?.name || e164 })
      ok = r.ok; detail = r.ok ? '' : String(r.error || 'appel impossible')
      await sb.from('espace_appels').insert({ mission_id: m.id, call_id: r.callId || null, audio: 'rappel-acceptation.wav', status: r.ok ? 'lance' : 'echec', detail: r.ok ? null : detail.slice(0, 300) })
    }
    const nom = (u as any)?.name || 'Le chauffeur'
    const min = Math.round((now - new Date(m.assigned_at as string).getTime()) / 60_000)
    await sb.from('mission_logs').insert({
      mission_id: m.id, action: 'appel_acceptation',
      notes: ok ? `${nom} n'avait pas accepté après ${min} min : appel téléphonique automatique.` : `${nom} n'avait pas accepté après ${min} min : appel automatique impossible (${detail}).`,
      metadata: { driver_id: m.assigned_to, ok, detail: detail || null, auto: true },
    }).then(() => {}, () => {})
    await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'acceptation_en_retard', {
      title: `📞 ${nom} n'a pas accepté (${min} min)`,
      body: `Mission #${m.mission_number ?? ''} ${m.vehicle_plate || ''} ${m.incident_city ? `à ${m.incident_city}` : ''} : ${ok ? 'il vient d\'être appelé automatiquement.' : `appel automatique impossible (${detail}) — à appeler.`}`.replace(/\s+/g, ' '),
      action_url: `/dispatch/${m.id}`,
      mission_id: m.id,
    }).catch(() => {})
    calls++
  }
  return calls
}


// Les appels d'IA de ce passage sont comptés sous « cron:accept-reminders » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:accept-reminders' }, () => handleGET(...args))
}

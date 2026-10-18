// Cron (chaque minute) — pause et transfert de mission (Olivier 18/10/2026).
//  1. Pause : à l'heure prévue, rappel au chauffeur ; 15 min plus tard sans reprise, relance au
//     chauffeur + alerte au dispatch.
//  2. Transfert : 5 min sans réponse du chauffeur B → appel téléphonique automatique (message
//     vocal transfert-a-accepter.wav, joué au décroché comme les autres appels) ; encore 5 min sans
//     réponse → transfert annulé, la mission reste à A, prévenu par notification et par appel
//     (transfert-annule.wav).
// Un cron en échec doit se voir : erreur → réponse 500.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification, sendNotificationToRoles } from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RELANCE_MIN = 15
const TRANSFER_CALL_MIN = 5
const TRANSFER_CANCEL_MIN = 5   // après l'appel à B

type Sb = ReturnType<typeof createAdminClient>
/** Appel téléphonique automatique avec un message enregistré. */
async function phoneCall(sb: Sb, missionId: string, userId: string, audio: string): Promise<{ ok: boolean; name: string; detail: string }> {
  const { data: u } = await sb.from('users').select('name, phone').eq('id', userId).maybeSingle()
  let phone = (u as any)?.phone || null
  if (!phone) { const { data: p } = await sb.from('personnel').select('phone').eq('user_id', userId).maybeSingle(); phone = (p as any)?.phone || null }
  const name = (u as any)?.name || 'Le chauffeur'
  const { toE164 } = await import('@/lib/missions/market-proposals')
  const e164 = toE164(phone)
  if (!e164) return { ok: false, name, detail: 'pas de numéro de téléphone exploitable' }
  const { initiatePstnCall } = await import('@/lib/teams/call')
  const r = await initiatePstnCall({ toPhone: e164, toDisplayName: name })
  const detail = r.ok ? '' : String(r.error || 'appel impossible')
  await sb.from('espace_appels').insert({ mission_id: missionId, call_id: r.callId || null, audio, status: r.ok ? 'lance' : 'echec', detail: r.ok ? null : detail.slice(0, 300) })
  return { ok: r.ok, name, detail }
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const now = Date.now(), iso = new Date(now).toISOString()
  try {
    const { data: users } = await sb.from('users').select('id, name')
    const nm = Object.fromEntries((users || []).map((u: any) => [u.id, u.name]))
    const log = (missionId: string, action: string, notes: string) => sb.from('mission_logs').insert({ mission_id: missionId, action, notes }).then(() => {}, () => {})

    // 1a. Rappel à l'heure prévue.
    const { data: due } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, incident_address, assigned_to, pause_until').not('paused_at', 'is', null).is('pause_reminded_at', null).lte('pause_until', iso).limit(30)
    for (const m of due || []) {
      const { data: pris } = await sb.from('incoming_missions').update({ pause_reminded_at: iso }).eq('id', m.id).is('pause_reminded_at', null).select('id').maybeSingle()
      if (!pris || !m.assigned_to) continue
      await sendNotification(m.assigned_to, 'mission_pause_rappel', { title: `⏰ C'est l'heure de reprendre ${m.vehicle_plate || ''}`, body: `${m.incident_address || ''} — ouvre la mission et appuie sur « Reprendre ».`, mission_id: m.id, action_url: `/mission/${m.id}` }).catch(() => {})
      await log(m.id, 'pause_reminder', `Rappel envoyé à ${nm[m.assigned_to] || 'le chauffeur'} : heure de reprise atteinte.`)
    }
    // 1b. 15 min après, toujours en pause : relance + dispatch.
    const { data: late } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, incident_address, assigned_to, pause_until').not('paused_at', 'is', null).not('pause_reminded_at', 'is', null).is('pause_relance_at', null).lte('pause_until', new Date(now - RELANCE_MIN * 60_000).toISOString()).limit(30)
    for (const m of late || []) {
      const { data: pris } = await sb.from('incoming_missions').update({ pause_relance_at: iso }).eq('id', m.id).is('pause_relance_at', null).select('id').maybeSingle()
      if (!pris) continue
      const nom = (m.assigned_to && nm[m.assigned_to]) || 'Le chauffeur'
      if (m.assigned_to) await sendNotification(m.assigned_to, 'mission_pause_rappel', { title: `⏰ Rappel : reprends ${m.vehicle_plate || ''}`, body: 'L’heure de reprise est dépassée. Reprends la mission ou change l’heure.', mission_id: m.id, action_url: `/mission/${m.id}` }).catch(() => {})
      await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'mission_pause_depassee', { title: `⏸ ${nom} n'a pas repris ${m.vehicle_plate || ''}`, body: `Mission #${m.mission_number ?? ''} en pause, reprise prévue dépassée de ${RELANCE_MIN} min.`, mission_id: m.id, action_url: `/dispatch/${m.id}` }).catch(() => {})
      await log(m.id, 'pause_overdue', `${nom} n'a pas repris la mission ${RELANCE_MIN} min après l'heure prévue : relance au chauffeur et alerte au dispatch.`)
    }

    // 2. Transfert sans réponse depuis 5 min : appel automatique à B.
    const { data: tr } = await sb.from('incoming_missions').select('id, mission_number, transfer_to, transfer_from, transfer_requested_at').not('transfer_to', 'is', null).is('transfer_call_at', null).lte('transfer_requested_at', new Date(now - TRANSFER_CALL_MIN * 60_000).toISOString()).limit(20)
    let calls = 0
    for (const m of tr || []) {
      const { data: pris } = await sb.from('incoming_missions').update({ transfer_call_at: iso }).eq('id', m.id).is('transfer_call_at', null).select('id').maybeSingle()
      if (!pris) continue
      const c = await phoneCall(sb, m.id, m.transfer_to as string, 'transfert-a-accepter.wav')
      if (c.ok) calls++
      await log(m.id, 'transfer_call', c.ok ? `${c.name} n'a pas répondu au transfert de ${nm[m.transfer_from as string] || '?'} après ${TRANSFER_CALL_MIN} min : appel téléphonique automatique.` : `${c.name} n'a pas répondu au transfert après ${TRANSFER_CALL_MIN} min : appel automatique impossible (${c.detail}).`)
    }

    // 3. Toujours pas de réponse 5 min après l'appel : transfert annulé, la mission reste à A.
    const { data: tc } = await sb.from('incoming_missions').select('id, vehicle_plate, assigned_to, transfer_to, transfer_from, transfer_call_at').not('transfer_to', 'is', null).not('transfer_call_at', 'is', null).lte('transfer_call_at', new Date(now - TRANSFER_CANCEL_MIN * 60_000).toISOString()).limit(20)
    let annules = 0
    for (const m of tc || []) {
      const { data: pris } = await sb.from('incoming_missions').update({ transfer_to: null, transfer_from: null, transfer_reason: null, transfer_requested_at: null, transfer_call_at: null, updated_at: iso }).eq('id', m.id).eq('transfer_to', m.transfer_to as string).eq('transfer_call_at', m.transfer_call_at as string).select('id').maybeSingle()
      if (!pris) continue
      annules++
      const a = (m.transfer_from || m.assigned_to) as string | null
      const bName = nm[m.transfer_to as string] || 'Le collègue'
      if (a) {
        await sendNotification(a, 'mission_transfert_reponse', { title: `✗ Transfert annulé : ${bName} n'a pas répondu`, body: `La mission ${m.vehicle_plate || ''} reste à toi. Reprends-la ou propose-la à un autre collègue.`, mission_id: m.id, action_url: `/mission/${m.id}` }).catch(() => {})
        const c = await phoneCall(sb, m.id, a, 'transfert-annule.wav')
        await log(m.id, 'transfer_cancelled', `Transfert annulé automatiquement : ${bName} n'a pas répondu en ${TRANSFER_CALL_MIN + TRANSFER_CANCEL_MIN} min. La mission reste à ${c.name}${c.ok ? ', prévenu par appel téléphonique' : ` (appel impossible : ${c.detail})`}.`)
      }
    }
    return NextResponse.json({ ok: true, rappels: (due || []).length, relances: (late || []).length, appels: calls, transferts_annules: annules })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}

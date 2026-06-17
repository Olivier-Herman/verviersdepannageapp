// src/app/api/cron/accept-reminders/route.ts
//
// Rappel d'acceptation : une mission assignée à un chauffeur mais non acceptée
// (status='assigned', accepted_at null) reçoit un rappel push au chauffeur, pour
// qu'il l'accepte. Anti-spam : 1er rappel après FIRST_DELAY_MIN, puis tous les
// INTERVAL_MIN, jusqu'à MAX_REMINDERS. Olivier 2026-06-18.

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'

const FIRST_DELAY_MIN = 3   // attendre 3 min après l'assignation avant le 1er rappel
const INTERVAL_MIN    = 5   // délai minimum entre deux rappels
const MAX_REMINDERS   = 4   // ~3 + 3×5 = jusqu'à ~18 min de relance

export async function GET(req: Request) {
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
    const vehicleLabel = [m.vehicle_brand, m.vehicle_model, m.vehicle_plate].filter(Boolean).join(' ')
    try {
      await sendNotification(m.assigned_to as string, 'mission_assigned_manual', {
        title:      `⏰ À accepter — ${typeLabel}`,
        body:       `Mission en attente de ton acceptation : ${vehicleLabel || m.incident_city || m.incident_address || ''}`,
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

  if (sent) console.log(`[accept-reminders] ${sent} rappel(s) envoyé(s)`)
  return NextResponse.json({ ok: true, sent, checked: (missions || []).length })
}

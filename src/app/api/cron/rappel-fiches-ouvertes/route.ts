// src/app/api/cron/rappel-fiches-ouvertes/route.ts
//
// Rappel aux chauffeurs : fiche assignée depuis plus de X heures, ni clôturée
// ni mise en parc. Olivier 22/09/2026 : « il faudrait créer un système de
// rappel pour les chauffeurs qui ont une fiche assignée depuis plus de x
// heures. Fred Palm a une fiche qui aura bientôt 50 h, il faut qu'il la clôture. »
//   • 1er rappel après `rappel_fiche_ouverte_heures` (réglages, 24 h) ;
//   • puis toutes les `rappel_fiche_ouverte_repeat_heures` (12 h) tant que la
//     fiche reste ouverte ; à partir du 2e rappel le dispatch est prévenu aussi ;
//   • une fiche au parc n'est pas concernée (le véhicule est chez nous, la
//     suite se décide au bureau).
// Toutes les heures à h+15 (vercel.json). Protégé par CRON_SECRET.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification, sendNotificationToRoles } from '@/lib/notifications/send'
import { getBusinessNumber } from '@/lib/settings/business'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const OPEN_STATUSES = ['assigned', 'accepted', 'in_progress', 'delivering']

const fmtH = (h: number) => h >= 48 ? `${Math.round(h / 24)} jours` : `${Math.round(h)} h`

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const firstH  = Math.max(1, await getBusinessNumber('rappel_fiche_ouverte_heures') || 24)
  const repeatH = Math.max(1, await getBusinessNumber('rappel_fiche_ouverte_repeat_heures') || 12)
  const now = Date.now()
  const assignedBefore = new Date(now - firstH * 3600_000).toISOString()
  const remindBefore   = new Date(now - repeatH * 3600_000).toISOString()

  const { data: missions, error } = await sb
    .from('incoming_missions')
    .select('id, mission_number, source, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_city, assigned_to, assigned_at, open_reminder_count')
    .in('status', OPEN_STATUSES)
    .eq('dossier_leg', false)
    .not('assigned_to', 'is', null)
    .lt('assigned_at', assignedBefore)
    .or(`open_reminder_at.is.null,open_reminder_at.lt.${remindBefore}`)
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const driverIds = Array.from(new Set((missions || []).map(m => m.assigned_to as string)))
  const { data: users } = driverIds.length ? await sb.from('users').select('id, name').in('id', driverIds) : { data: [] as any[] }
  const nameOf = (id: string) => (users || []).find((u: any) => u.id === id)?.name || 'le chauffeur'

  let sent = 0, dispatch = 0
  for (const m of (missions || [])) {
    const hours = (now - Date.parse(String(m.assigned_at))) / 3600_000
    const vehicle = [m.vehicle_brand, m.vehicle_model, m.vehicle_plate].filter(Boolean).join(' ') || m.incident_city || `#${m.mission_number}`
    const n = (m.open_reminder_count || 0) + 1
    try {
      await sendNotification(m.assigned_to as string, 'fiche_ouverte_rappel', {
        title:      `⏰ Fiche à clôturer — ${vehicle}`,
        body:       `Cette fiche t'est attribuée depuis ${fmtH(hours)} et n'est pas clôturée. Termine-la ou mets-la en parc.${n > 1 ? ` (${n}e rappel)` : ''}`,
        action_url: `/mission/${m.id}`,
        mission_id: m.id,
        data:       { reminder: n, hours: Math.round(hours) },
      })
      sent++
      if (n >= 2) {
        await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'fiche_ouverte_dispatch', {
          title:      `⏰ ${nameOf(m.assigned_to as string)} n'a pas clôturé ${vehicle}`,
          body:       `Fiche #${m.mission_number} ouverte depuis ${fmtH(hours)} malgré ${n - 1} rappel${n > 2 ? 's' : ''}.`,
          action_url: `/dispatch/${m.id}`,
          mission_id: m.id,
          data:       { reminder: n, hours: Math.round(hours), driver_id: m.assigned_to },
        })
        dispatch++
      }
      await sb.from('incoming_missions').update({ open_reminder_at: new Date().toISOString(), open_reminder_count: n }).eq('id', m.id)
      await sb.from('mission_logs').insert({
        mission_id: m.id, actor_id: null, action: 'open_reminder',
        notes: `Rappel de clôture n°${n} envoyé à ${nameOf(m.assigned_to as string)} (fiche ouverte depuis ${fmtH(hours)})${n >= 2 ? ' · dispatch prévenu' : ''}`,
        metadata: { reminder: n, hours: Math.round(hours) },
      }).then(() => {}, () => {})
    } catch (e: any) {
      console.error('[rappel-fiches-ouvertes]', m.id, e?.message)
    }
  }
  if (sent) console.log(`[rappel-fiches-ouvertes] ${sent} rappel(s), ${dispatch} au dispatch`)
  return NextResponse.json({ ok: true, sent, dispatch, checked: (missions || []).length, firstH, repeatH })
}

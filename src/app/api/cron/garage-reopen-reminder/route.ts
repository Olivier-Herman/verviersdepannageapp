// src/app/api/cron/garage-reopen-reminder/route.ts
//
// Rappel quotidien : les véhicules revenus au parc pour « garage fermé » dont la
// date de réouverture tombe AUJOURD'HUI → push au dispatch pour penser à relivrer.
// Olivier 2026-07-14.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToRole }    from '@/lib/push'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD

  // Véhicules encore en parc dont le garage rouvre aujourd'hui.
  const { data: rows, error } = await sb
    .from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, redelivery_address, garage_reopen_date')
    .eq('garage_reopen_date', today)
    .eq('status', 'parked')
    .is('archived_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const list = rows || []
  if (list.length === 0) return NextResponse.json({ ok: true, reminded: 0 })

  const label = list
    .map(m => `${m.vehicle_plate || '—'}${m.mission_number != null ? ` (#${m.mission_number})` : ''}`)
    .slice(0, 6)
    .join(', ')
  const more = list.length > 6 ? ` +${list.length - 6}` : ''

  try {
    await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
      title: `🔒 Garage rouvre aujourd'hui — ${list.length} à relivrer`,
      body:  `${label}${more} : le garage destinataire rouvre aujourd'hui, pense à relivrer.`,
      url:   '/dispatch',
      tag:   `garage-reopen-${today}`,
    })
  } catch (e: any) {
    console.error('[garage-reopen-reminder] push KO:', e?.message)
  }

  // Trace sur chaque fiche (visible dans l'historique / le journal d'activité).
  for (const m of list) {
    await sb.from('mission_logs').insert({
      mission_id: m.id, actor_id: null, action: 'garage_reopen_due',
      notes: `Rappel : le garage rouvre aujourd'hui (${today}) → à relivrer.`,
      metadata: { garage_reopen_date: today, redelivery_address: m.redelivery_address || null },
    }).then(() => {}, () => {})
  }

  return NextResponse.json({ ok: true, reminded: list.length })
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser } from '@/lib/push'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const today    = new Date().toISOString().split('T')[0]

  const { data: scheduledChecks } = await supabase
    .from('vehicle_checks')
    .select('*, vehicle:check_vehicles(id, name, plate)')
    .eq('scheduled_date', today)
    .eq('status', 'scheduled')

  if (!scheduledChecks || scheduledChecks.length === 0) {
    return NextResponse.json({ activated: 0, date: today })
  }

  const { data: setting } = await supabase
    .from('app_settings').select('value').eq('key', 'check_responsible_ids').single()
  const responsibleIds: string[] = setting ? JSON.parse(setting.value) : []

  let activated = 0
  for (const check of scheduledChecks) {
    await supabase
      .from('vehicle_checks')
      .update({ status: 'pending_claim', updated_at: new Date().toISOString() })
      .eq('id', check.id)

    const plate = check.vehicle?.plate || 'Véhicule inconnu'
    const name  = check.vehicle?.name  || ''

    for (const rid of responsibleIds) {
      await sendPushToUser(rid, {
        title: '🔍 Contrôle véhicule à prendre en charge',
        body:  `Contrôle planifié aujourd'hui : ${name} (${plate}). Ouvrez l'app pour le prendre en charge.`,
        url:   `${process.env.NEXT_PUBLIC_APP_URL}/check-vehicule/${check.id}`,
      })
    }
    activated++
  }

  return NextResponse.json({ activated, date: today })
}

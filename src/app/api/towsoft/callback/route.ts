// src/app/api/towsoft/callback/route.ts
// Appelé par GitHub Actions après création TowSoft pour mettre à jour le ticket Helpdesk

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const body = await req.json()
  const { queue_id, mission_number, secret } = body

  if (secret !== process.env.TOWSOFT_CALLBACK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!queue_id || !mission_number) {
    return NextResponse.json({ error: 'queue_id et mission_number requis' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: queue } = await supabase
    .from('towsoft_queue')
    .select('odoo_ticket_id, status')
    .eq('id', queue_id)
    .maybeSingle()

  if (!queue?.odoo_ticket_id) {
    return NextResponse.json({ error: 'Ticket Odoo non trouvé pour cette queue' }, { status: 404 })
  }

  // Mettre à jour le numéro TowSoft dans Odoo
  try {
    const { updateHelpdeskTowsoftNumber } = await import('@/lib/odoo-fsm')
    await updateHelpdeskTowsoftNumber(queue.odoo_ticket_id, mission_number)
    console.log(`[Callback] Ticket #${queue.odoo_ticket_id} → TowSoft ${mission_number}`)
  } catch (e: any) {
    console.error('[Callback] Erreur Odoo:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  // Déclencher l'impression de l'étiquette
  try {
    const printUrl = `https://verviers-qr.vercel.app/print/${queue.odoo_ticket_id}`
    await fetch(printUrl, { method: 'GET' })
    console.log(`[Callback] Impression étiquette déclenchée: ${printUrl}`)
  } catch (e: any) {
    console.error('[Callback] Impression échec:', e.message)
  }

  return NextResponse.json({ ok: true })
}

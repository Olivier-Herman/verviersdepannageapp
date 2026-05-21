// src/app/api/towsoft/callback/route.ts
import { NextResponse }            from 'next/server'
import { createAdminClient }       from '@/lib/supabase'
import { printZebraLabelForTicket } from '@/lib/print/zebra'

export async function POST(req: Request) {
  const body = await req.json()
  const { queue_id, mission_number, secret, print_label } = body

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

  // Impression étiquette (seulement si print_label !== false).
  // Bascule du chemin Verviers-QR vers le helper verviers-app integre,
  // qui utilise la meme imprimante Zebra (ZEBRA_REMOTE) et le meme format.
  if (print_label !== false) {
    const result = await printZebraLabelForTicket(queue.odoo_ticket_id)
    if (result.ok) {
      console.log(`[Callback] Impression OK ticket #${queue.odoo_ticket_id} plate=${result.plate || '?'} motif=${result.motif || '?'}`)
    } else {
      console.error(`[Callback] Impression echec ticket #${queue.odoo_ticket_id}:`, result.error)
    }
  }

  return NextResponse.json({ ok: true })
}

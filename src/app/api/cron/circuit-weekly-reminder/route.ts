// src/app/api/cron/circuit-weekly-reminder/route.ts
//
// Cron Vercel : tous les lundis a 12h, envoie une notif push aux dispatchers
// + admins + superadmins listant les prestations circuit a facturer pour la
// semaine passee (lundi-dimanche de la semaine precedente).
//
// Filtre : invoiced_at IS NULL ET prestation_date >= lundi-7j ET <= dimanche-1j
//
// La notif contient :
//   - title : "Prestations circuit à facturer"
//   - body  : "X prestation(s) pour Y clients - voir le détail"
//   - url   : /circuit?period=to_invoice
//
// Auth : Bearer CRON_SECRET

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToRole }    from '@/lib/push'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()

  // Calcule la plage : lundi precedent 00:00 -> dimanche precedent 23:59
  // Si execute un lundi : on regarde lundi-7j -> dimanche-1j (= dim. passe)
  const now = new Date()
  // last Sunday (dimanche passe)
  const lastSunday = new Date(now)
  lastSunday.setDate(now.getDate() - now.getDay()) // dimanche passe
  lastSunday.setHours(0, 0, 0, 0)
  // last Monday (lundi de la semaine passee)
  const lastMonday = new Date(lastSunday)
  lastMonday.setDate(lastSunday.getDate() - 6)
  // Pour les bornes SQL on utilise format YYYY-MM-DD
  const fromIso = lastMonday.toISOString().slice(0, 10)
  const toIso   = lastSunday.toISOString().slice(0, 10)

  // Charge les prestations non encore facturees de la semaine passee
  const { data: prestations, error } = await sb
    .from('circuit_prestations')
    .select('id, client_name, type, prestation_date, nb_depanneuses, odoo_sale_order_id, odoo_sale_order_name')
    .gte('prestation_date', fromIso)
    .lte('prestation_date', toIso)
    .is('invoiced_at', null)
    .order('prestation_date', { ascending: true })

  if (error) {
    console.error('[circuit-weekly-reminder] SELECT KO:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!prestations || prestations.length === 0) {
    return NextResponse.json({
      ok: true,
      message: `Aucune prestation a facturer pour la semaine ${fromIso} -> ${toIso}`,
      sent: 0,
    })
  }

  // Regroupe par client (et donc par devis Odoo) pour le message
  const byClient = new Map<string, { client_name: string; count: number; order_name?: string; order_id?: number }>()
  for (const p of prestations) {
    const key = `${p.client_name}|${p.odoo_sale_order_id || 'no-order'}`
    if (!byClient.has(key)) {
      byClient.set(key, {
        client_name: p.client_name,
        count:       0,
        order_name:  p.odoo_sale_order_name || undefined,
        order_id:    p.odoo_sale_order_id || undefined,
      })
    }
    byClient.get(key)!.count += 1
  }

  const nbClients = byClient.size
  const nbPrestations = prestations.length

  // Push notif aux dispatchers + admins + superadmins
  await sendPushToRole(
    ['dispatcher', 'admin', 'superadmin'],
    {
      title: '📋 Prestations circuit à facturer',
      body:  `${nbPrestations} prestation(s) pour ${nbClients} client(s) - semaine du ${formatDateShort(fromIso)} au ${formatDateShort(toIso)}`,
      url:   '/circuit?period=to_invoice',
      tag:   `circuit-weekly-${fromIso}`,
      icon:  '/icons/apple-touch-icon.png',
    },
  )

  return NextResponse.json({
    ok: true,
    week: { from: fromIso, to: toIso },
    nb_prestations: nbPrestations,
    nb_clients:     nbClients,
    by_client:      Array.from(byClient.values()),
  })
}

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(-2)}`
}

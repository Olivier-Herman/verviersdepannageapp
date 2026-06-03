// src/app/api/admin/parc/refresh-dates/route.ts
//
// POST /api/admin/parc/refresh-dates
// Pour les missions VD Soft creees par prepare-full-inventory avec une heure
// d intervention a 00:00 UTC (= 02:00 Brussels), refait la sync de la date+
// heure depuis Odoo helpdesk.ticket.create_date qui contient HH:MM:SS.
//
// Garde la DATE depuis x_studio_date_dentree (peut differer de create_date)
// mais combine avec l HEURE de create_date (proxy le plus proche de l entree
// parc reelle).
//
// Rapide : fait tout en 1 batch Odoo (pas de Browserless).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  // 1. Missions avec heure suspecte (00:00:00 UTC) ET odoo_helpdesk_id non-null
  // (= candidates pour la sync depuis Odoo create_date).
  const { data: missions, error: e1 } = await sb
    .from('incoming_missions')
    .select('id, intervention_date, odoo_helpdesk_id, towsoft_enriched_at')
    .not('odoo_helpdesk_id', 'is', null)
    .in('status', ['parked', 'delivering', 'unlocated', 'awaiting_payment'])
    .limit(2000)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // Filtre les missions a heure suspecte (T00:00:00 ou T22:00:00 / T23:00:00 UTC)
  const suspicious = (missions || []).filter(m => {
    if (!m.intervention_date) return true
    // 00:00:00 UTC ou heure ronde sont suspectes
    return /T(00|22|23):00:00/.test(m.intervention_date)
  })

  if (suspicious.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Aucune mission a heure suspecte' })
  }

  // 2. Fetch tous les tickets Odoo en 1 call (rapide)
  const ticketIds = Array.from(new Set(suspicious.map(m => m.odoo_helpdesk_id).filter(Boolean) as number[]))
  const tickets = await odooRpc<any[]>('helpdesk.ticket', 'read', [ticketIds], {
    fields: ['id', 'create_date', 'x_studio_date_dentree'],
  })
  const ticketMap = new Map<number, { create_date: string; x_studio_date_dentree: string | null }>()
  for (const t of (tickets || [])) {
    ticketMap.set(t.id, {
      create_date:           t.create_date,
      x_studio_date_dentree: t.x_studio_date_dentree && t.x_studio_date_dentree !== false ? String(t.x_studio_date_dentree) : null,
    })
  }

  // 3. Pour chaque mission, calculer la bonne date+heure et UPDATE
  let updated = 0
  let skipped = 0
  for (const m of suspicious) {
    const t = ticketMap.get(m.odoo_helpdesk_id!)
    if (!t || !t.create_date) { skipped++; continue }

    // create_date Odoo : 'YYYY-MM-DD HH:MM:SS' (UTC)
    // x_studio_date_dentree : 'YYYY-MM-DD' (date seule)
    // On combine : date de x_studio_date_dentree + heure de create_date
    let dateIso: string | null = null
    const createDate = t.create_date.replace(' ', 'T')
    if (t.x_studio_date_dentree) {
      const dateOnly = t.x_studio_date_dentree.slice(0, 10)
      const timeOnly = t.create_date.slice(11, 19)  // 'HH:MM:SS'
      dateIso = `${dateOnly}T${timeOnly}.000Z`  // UTC
    } else {
      dateIso = `${createDate}.000Z`
    }

    const d = new Date(dateIso)
    if (!isFinite(d.getTime())) { skipped++; continue }

    await sb.from('incoming_missions').update({
      intervention_date: d.toISOString(),
      received_at:       d.toISOString(),
      // Si parked_at etait NULL ou la meme heure suspecte, on l update aussi
      parked_at:         d.toISOString(),
    }).eq('id', m.id)
    updated++
  }

  return NextResponse.json({
    ok: true,
    candidates: suspicious.length,
    updated,
    skipped,
    message: `${updated} missions updatees avec heure Odoo create_date. Pour la VRAIE heure d entree parc (depuis TowSoft), utilise 'Enrichir missions via TowSoft'.`,
  })
}

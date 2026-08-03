// src/app/api/circuit-race/route.ts
//
// Week-ends de COURSE (circuit) — encodage + devis Odoo (brouillon par défaut).
// GET                       → liste des week-ends
// POST {action:'save', ...} → crée/édite un week-end (label, client, days[])
// POST {action:'quote', id} → crée le devis Odoo BROUILLON (sections/jour + produits)
// POST {action:'delete', id}
// Permissions : dispatcher / admin / superadmin

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { withOdooActor }     from '@/lib/odoo'
import { createRaceWeekendQuote } from '@/lib/circuit/odoo-quote'

export const dynamic     = 'force-dynamic'
export const fetchCache  = 'force-no-store'
export const maxDuration  = 60

const ALLOWED = ['dispatcher', 'admin', 'superadmin']
const hasAccess = (u: any) => ALLOWED.includes(u?.role) || (Array.isArray(u?.roles) && u.roles.some((r: string) => ALLOWED.includes(r)))

const cleanDays = (arr: any): any[] => (Array.isArray(arr) ? arr : [])
  .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
  .map(d => ({ date: d.date, nb: Math.max(1, Number(d.nb) || 1), jour: !!d.jour, nuit: !!d.nuit, supp: Math.max(0, Number(d.supp) || 0) }))

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!hasAccess(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data } = await sb.from('circuit_race_weekends').select('*').order('created_at', { ascending: false })
  return NextResponse.json({ weekends: data || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!hasAccess(u)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'save') {
    const label = String(body.label || '').trim()
    if (!label) return NextResponse.json({ error: 'Intitulé requis' }, { status: 400 })
    const row: any = {
      label, client_name: String(body.client_name || '').trim() || null,
      client_odoo_id: body.client_odoo_id ? Number(body.client_odoo_id) : null,
      days: cleanDays(body.days), notes: String(body.notes || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (body.id) { await sb.from('circuit_race_weekends').update(row).eq('id', String(body.id)); return NextResponse.json({ ok: true, id: body.id }) }
    row.created_by = u.id
    const { data, error } = await sb.from('circuit_race_weekends').insert(row).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  }

  if (action === 'quote') {
    const { data: w } = await sb.from('circuit_race_weekends').select('*').eq('id', String(body.id || '')).maybeSingle()
    if (!w) return NextResponse.json({ error: 'Week-end introuvable' }, { status: 404 })
    if (!w.client_odoo_id) return NextResponse.json({ error: 'Client Odoo requis (recherche le client d\'abord)' }, { status: 400 })
    const days = cleanDays(w.days).map((d: any) => ({ date: d.date, nb_depanneuses: d.nb, jour: d.jour, nuit: d.nuit, supplement_h: d.supp }))
    if (!days.length) return NextResponse.json({ error: 'Aucun jour encodé' }, { status: 400 })
    try {
      const order = await withOdooActor(u.id, () => createRaceWeekendQuote({
        partnerId: w.client_odoo_id, label: w.label, days, notes: w.notes || undefined, confirm: false,
      }))
      await sb.from('circuit_race_weekends').update({ odoo_sale_order_id: order.id, odoo_sale_order_name: order.name, updated_at: new Date().toISOString() }).eq('id', w.id)
      return NextResponse.json({ ok: true, order })
    } catch (e: any) { return NextResponse.json({ error: `Devis Odoo : ${e.message}` }, { status: 500 }) }
  }

  if (action === 'delete') {
    await sb.from('circuit_race_weekends').delete().eq('id', String(body.id || ''))
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}

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

const time = (t: any) => /^\d{1,2}:\d{2}$/.test(String(t || '')) ? String(t) : null
const cleanSupps = (arr: any, defNb: number) => (Array.isArray(arr) ? arr : []).filter((s: any) => time(s?.from) && time(s?.to)).map((s: any) => ({ from: time(s.from), to: time(s.to), nb: Math.max(1, Number(s.nb) || defNb) }))
const cleanDays = (arr: any): any[] => (Array.isArray(arr) ? arr : [])
  .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
  .map(d => {
    const nb = Math.max(1, Number(d.nb) || 1)
    let supps = cleanSupps(d.supps, nb)
    if (!supps.length && time(d.supp_from) && time(d.supp_to)) supps = [{ from: time(d.supp_from), to: time(d.supp_to), nb }]   // compat ancien format
    return { date: d.date, nb, jour: !!d.jour, nuit: !!d.nuit, supps, note: typeof d.note === 'string' ? d.note.slice(0, 300) : null, drivers: Array.isArray(d.drivers) ? d.drivers.filter((x: any) => typeof x === 'string') : [] }
  })
const suppHrs = (from?: string | null, to?: string | null) => { if (!from || !to) return 0; const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return (h || 0) * 60 + (mm || 0) }; let d = m(to) - m(from); if (d < 0) d += 1440; return Math.round(d / 60 * 100) / 100 }
const PRICE_FORFAIT = 650, PRICE_HSUPP = 75   // prix HTVA Odoo (Course / Heure suppl.)

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!hasAccess(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data } = await sb.from('circuit_race_weekends').select('*').order('created_at', { ascending: false })
  const { data: personnel } = await sb.from('personnel').select('id, name').eq('active', true).neq('kind', 'independant').order('name')
  return NextResponse.json({ weekends: data || [], personnel: personnel || [] })
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
    const days = cleanDays(w.days).map((d: any) => ({ date: d.date, nb_depanneuses: d.nb, jour: d.jour, nuit: d.nuit, supps: d.supps, note: d.note || undefined }))
    if (!days.length) return NextResponse.json({ error: 'Aucun jour encodé' }, { status: 400 })
    try {
      const order = await withOdooActor(u.id, () => createRaceWeekendQuote({
        partnerId: w.client_odoo_id, label: w.label, days, notes: w.notes || undefined, confirm: false,
        existingOrderId: w.odoo_sale_order_id || undefined,   // met à jour le devis existant (nouveaux suppléments)
      }))
      await sb.from('circuit_race_weekends').update({ odoo_sale_order_id: order.id, odoo_sale_order_name: order.name, updated_at: new Date().toISOString() }).eq('id', w.id)

      // Répercussion CA rentabilité : 1 chauffeur interne = 1 dépanneuse (sa part =
      // forfait jour/nuit + supplément d'UNE dépanneuse pour ses jours). Idempotent.
      const cleaned = cleanDays(w.days)
      const acc = new Map<string, number>()   // personnelId|period -> montant
      for (const d of cleaned) {
        const suppH = (d.supps || []).reduce((a: number, s: any) => a + suppHrs(s.from, s.to), 0)
        const dayCA = (d.jour ? PRICE_FORFAIT : 0) + (d.nuit ? PRICE_FORFAIT : 0) + suppH * PRICE_HSUPP
        if (dayCA <= 0 || !d.drivers?.length) continue
        const period = String(d.date).slice(0, 7)
        for (const pid of d.drivers) acc.set(`${pid}|${period}`, (acc.get(`${pid}|${period}`) || 0) + dayCA)
      }
      await sb.from('driver_extra_ca').delete().eq('source', 'circuit_race').eq('source_id', w.id)
      const caRows = [...acc.entries()].map(([k, amount]) => { const [pid, period] = k.split('|'); return { personnel_id: pid, period, amount: Math.round(amount), label: `Course — ${w.label}`, source: 'circuit_race', source_id: w.id, created_by: u.id } })
      if (caRows.length) await sb.from('driver_extra_ca').insert(caRows)

      return NextResponse.json({ ok: true, order, ca_lines: caRows.length })
    } catch (e: any) { return NextResponse.json({ error: `Devis Odoo : ${e.message}` }, { status: 500 }) }
  }

  if (action === 'delete') {
    await sb.from('circuit_race_weekends').delete().eq('id', String(body.id || ''))
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}

// src/app/api/admin/labels/reprint-batch/route.ts
//
// POST /api/admin/labels/reprint-batch
// Body : { from: ISO date, to?: ISO date, sources?: string[] }
//
// Reprend en batch toutes les missions fourriere (sources Police) creees
// entre from et to qui ont un dossier_number Odoo (= ticket Helpdesk
// pre-existant). Pour chacune, regenere le ZPL via le template 'parc-entree'
// et l envoie au PC Zebra. Retourne un rapport detaille (succes / echecs).
//
// Cree pour rattraper le backlog du week-end 2026-05-23/24/25 quand le PC
// Zebra-serveur etait tombe et personne ne s en etait apercu (Olivier
// arrive lundi matin avec 15+ etiquettes manquantes).
//
// Reservee admin/superadmin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'
import { getLabelTemplate }  from '@/lib/print/zpl-templates'
import { printZPLRaw }       from '@/lib/print/zebra-raw'

export const maxDuration = 300  // 5 min : ~25 missions x 800ms + appels Odoo

const QR_BASE = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/v`
  : 'https://verviers-qr.vercel.app/v'

const DEFAULT_SOURCES = [
  'police_mg', 'police_rodeo', 'police_avp', 'police_saisie', 'police_accident',
]

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : []
  const isAdmin = ['admin', 'superadmin'].includes(role) ||
                  roles.some(r => ['admin', 'superadmin'].includes(r))
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!body.from) {
    return NextResponse.json({ error: 'from requis (ISO date, ex: "2026-05-23T00:00:00Z")' }, { status: 400 })
  }
  const fromIso = new Date(body.from).toISOString()
  const toIso   = body.to ? new Date(body.to).toISOString() : new Date().toISOString()
  const sources = Array.isArray(body.sources) && body.sources.length > 0 ? body.sources : DEFAULT_SOURCES
  const dryRun  = body.dry_run === true

  const sb = createAdminClient()
  const { data: missions, error } = await sb
    .from('incoming_missions')
    .select('id, external_id, dossier_number, source, vehicle_plate, vehicle_brand, vehicle_model, created_at')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .in('source', sources)
    .not('dossier_number', 'is', null)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      from: fromIso,
      to:   toIso,
      sources,
      total: missions?.length || 0,
      missions: (missions || []).map(m => ({
        id: m.id, plate: m.vehicle_plate, dossier: m.dossier_number, source: m.source, created_at: m.created_at,
      })),
    })
  }

  const template = getLabelTemplate('parc-entree')
  if (!template) {
    return NextResponse.json({ error: 'Template parc-entree introuvable' }, { status: 500 })
  }

  type Result = { mission_id: string; plate: string | null; dossier: string | null; source: string; ok: boolean; error?: string }
  const results: Result[] = []

  for (const m of missions || []) {
    const base: Result = { mission_id: m.id, plate: m.vehicle_plate, dossier: m.dossier_number, source: m.source, ok: false }

    // Extraire ticket_id depuis dossier_number (format "PREFIX-XXXX")
    const match = (m.dossier_number || '').match(/-(\d+)$/)
    if (!match) {
      results.push({ ...base, error: 'dossier_number invalide (pas de ticket Odoo extractible)' })
      continue
    }
    const ticketId = parseInt(match[1])

    try {
      const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
        [['id', '=', ticketId]],
      ], {
        fields: ['id', 'tag_ids', 'x_studio_date_dentree', 'x_studio_note_sur_etiquette'],
        limit: 1,
      })
      if (!tickets || tickets.length === 0) {
        results.push({ ...base, error: `Ticket Odoo ${ticketId} introuvable` })
        continue
      }
      const t = tickets[0]
      let motif = ''
      if (t.tag_ids?.length > 0) {
        const tags = await odooRpc<any[]>('helpdesk.tag', 'search_read', [[['id', 'in', t.tag_ids]]], { fields: ['name'], limit: 5 })
        motif = tags?.[0]?.name || ''
      }
      let date = ''
      if (t.x_studio_date_dentree) {
        const d = new Date(t.x_studio_date_dentree)
        date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
      }
      const note = (t.x_studio_note_sur_etiquette && t.x_studio_note_sur_etiquette !== false)
        ? String(t.x_studio_note_sur_etiquette) : ''

      const zpl = template.build({
        qrUrl: `${QR_BASE}/${ticketId}`,
        motif, date, note,
        brand: (m as any).vehicle_brand || undefined,
        model: (m as any).vehicle_model || undefined,
        plate: m.vehicle_plate || undefined,
      })
      const printResult = await printZPLRaw(zpl)
      results.push({ ...base, ok: printResult.ok, error: printResult.error })

      // Petit delai entre impressions (Zebra a besoin de 500-800ms pour
      // sortir l etiquette avant de recevoir la suivante)
      await new Promise(rs => setTimeout(rs, 800))
    } catch (e: any) {
      results.push({ ...base, error: e.message || 'Erreur inconnue' })
    }
  }

  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({
    ok:       okCount === results.length,
    from:     fromIso,
    to:       toIso,
    sources,
    total:    results.length,
    ok_count: okCount,
    fail_count: results.length - okCount,
    results,
  })
}

// src/app/api/admin/labels/print/route.ts
//
// Endpoint unifie pour la bibliotheque d etiquettes. Prend un template_key
// + une source de donnees (ticket Odoo ou mission Supabase ou statique)
// + une quantite (pour les templates fixes / repetition).
//
// GET  ?template_key=X&ticket_id=Y     -> preview du ZPL
// POST { template_key, ticket_id?, mission_id?, qty? }  -> imprime
//
// Reservee admin/superadmin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'
import { getLabelTemplate }  from '@/lib/print/zpl-templates'
import { labelaryPreviewUrl } from '@/lib/print/zpl-templates/parc-label'
import { printZPLRaw }       from '@/lib/print/zebra-raw'

const QR_BASE = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/v`
  : 'https://verviers-qr.vercel.app/v'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const user = session.user as any
  const role: string = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : []
  const isAdmin = ['admin', 'superadmin'].includes(role) ||
                  roles.some(r => ['admin', 'superadmin'].includes(r))
  if (!isAdmin) return { error: 'Forbidden', status: 403 } as const
  return null
}

// ─────────────────────────────────────────────────────────────────
// Recuperation des donnees selon la source du template
// ─────────────────────────────────────────────────────────────────
async function fetchParcEntreeData(ticketId: number) {
  const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
    [['id', '=', ticketId]],
  ], {
    fields: ['id', 'tag_ids', 'x_studio_date_dentree', 'x_studio_note_sur_etiquette'],
    limit: 1,
  })
  if (!tickets || tickets.length === 0) throw new Error(`Ticket Odoo ${ticketId} introuvable`)
  const t = tickets[0]

  let motif = ''
  if (t.tag_ids?.length > 0) {
    const tags = await odooRpc<any[]>('helpdesk.tag', 'search_read', [
      [['id', 'in', t.tag_ids]],
    ], { fields: ['name'], limit: 5 })
    motif = tags?.[0]?.name || ''
  }

  let date = ''
  if (t.x_studio_date_dentree) {
    const d = new Date(t.x_studio_date_dentree)
    date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
  }

  const note = (t.x_studio_note_sur_etiquette && t.x_studio_note_sur_etiquette !== false)
    ? String(t.x_studio_note_sur_etiquette)
    : ''

  return {
    qrUrl: `${QR_BASE}/${ticketId}`,
    motif,
    date,
    note,
  }
}

async function fetchRelData(missionId: string) {
  const sb = createAdminClient()
  const { data: m, error } = await sb
    .from('incoming_missions')
    .select(`
      id, dossier_number,
      vehicle_plate, vehicle_brand, vehicle_model,
      billed_to_name,
      destination_address, destination_city
    `)
    .eq('id', missionId)
    .single()
  if (error || !m) throw new Error(`Mission ${missionId} introuvable`)

  const brandModel = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ').toUpperCase()
  const fullAddress = [m.destination_address, m.destination_city].filter(Boolean).join(', ')

  // Le QR REL pointe vers la page landing /qr/mission/[id] de VD Soft. Quand
  // un chauffeur scanne l etiquette dans le parc, il peut choisir entre
  // "Consulter le dossier" et "Relivrer le vehicule" (cree la REL fille +
  // s assigne dessus). Cf src/app/qr/mission/[id]/page.tsx.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const qrUrl = `${appUrl.replace(/\/$/, '')}/qr/mission/${m.id}`

  return {
    qrUrl,
    plate:       m.vehicle_plate || '',
    brand_model: brandModel,
    assistance:  m.billed_to_name || '',
    address:     fullAddress,
  }
}

async function buildZplForTemplate(templateKey: string, params: {
  ticket_id?: number | null
  mission_id?: string | null
}): Promise<{ zpl: string; data: any }> {
  const template = getLabelTemplate(templateKey)
  if (!template) throw new Error(`Template "${templateKey}" inconnu`)

  let data: any
  if (template.data_source === 'odoo_ticket') {
    if (!params.ticket_id) throw new Error('ticket_id requis pour ce template')
    data = await fetchParcEntreeData(params.ticket_id)
  } else if (template.data_source === 'mission') {
    if (!params.mission_id) throw new Error('mission_id requis pour ce template')
    data = await fetchRelData(params.mission_id)
  } else if (template.data_source === 'static') {
    data = {}  // templates fixes (DOM, etc.) — aucune donnee dynamique
  }

  const zpl = template.build(data)
  return { zpl, data }
}

// ─────────────────────────────────────────────────────────────────
// GET : preview du ZPL sans imprimer
// ─────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(req.url)
  const templateKey = searchParams.get('template_key') || ''
  const ticketId    = parseInt(searchParams.get('ticket_id')  || '0') || null
  const missionId   = searchParams.get('mission_id') || null

  if (!templateKey) return NextResponse.json({ error: 'template_key requis' }, { status: 400 })

  try {
    const { zpl, data } = await buildZplForTemplate(templateKey, { ticket_id: ticketId, mission_id: missionId })
    return NextResponse.json({
      ok:           true,
      template_key: templateKey,
      label_data:   data,
      zpl,
      preview_url:  labelaryPreviewUrl(zpl),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────
// POST : imprime (avec quantite eventuelle pour repetition)
// ─────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const templateKey = body.template_key
  const ticketId    = body.ticket_id  ? parseInt(body.ticket_id)  : null
  const missionId   = body.mission_id || null
  const qty         = Math.max(1, Math.min(20, parseInt(body.qty || '1')))  // 1..20

  if (!templateKey) return NextResponse.json({ error: 'template_key requis' }, { status: 400 })

  try {
    const { zpl, data } = await buildZplForTemplate(templateKey, { ticket_id: ticketId, mission_id: missionId })

    // Impression repetee (qty fois). Sequentielle pour ne pas saturer le PC.
    const results: { ok: boolean; error?: string }[] = []
    for (let i = 0; i < qty; i++) {
      const r = await printZPLRaw(zpl)
      results.push(r)
      if (qty > 1 && i < qty - 1) await new Promise(rs => setTimeout(rs, 500))
    }
    const okCount = results.filter(r => r.ok).length

    return NextResponse.json({
      ok:           okCount === qty,
      qty,
      ok_count:     okCount,
      template_key: templateKey,
      label_data:   data,
      zpl,
      preview_url:  labelaryPreviewUrl(zpl),
      errors:       results.filter(r => !r.ok).map(r => r.error),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

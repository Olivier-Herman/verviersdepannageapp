// src/app/api/missions/terminated/route.ts
//
// GET /api/missions/terminated
//   ?status=all|to_invoice|invoiced|no_charge|cancelled  (default: all)
//   ?source=<key>
//   ?q=<search>
//   ?page=<n>          (default: 1)
//   ?includeArchived=1 (default: 0)
//
// Liste paginee des missions "terminees" (cycle de vie cloture) :
//   - status='to_invoice'  → en attente facturation
//   - status='completed' + invoice_number → facturee
//   - status='completed' + invoice_method='auto' → autofacturee
//   - status='completed' + no_charge_at → sans frais
//   - status='cancelled'  → annulee
//
// Toggle includeArchived inclut/exclut les missions archivees.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation') ||
    modules.includes('dispatch')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url    = new URL(req.url)
  const statusFilter = url.searchParams.get('status') || 'all'
  const source = url.searchParams.get('source') || ''
  const q      = (url.searchParams.get('q') || '').trim()
  const page   = Math.max(1, Number(url.searchParams.get('page') || '1'))
  const includeArchived = url.searchParams.get('includeArchived') === '1'

  const sb = createAdminClient()
  let query = sb
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id, dossier_number, source, status,
      mission_type, incident_type, parent_mission_id,
      vehicle_plate, vehicle_brand, vehicle_model,
      client_name, intervention_date, completed_at,
      invoiced_at, invoice_number, invoice_method, invoice_url,
      no_charge_at, no_charge_reason,
      archived_at, received_at
    `, { count: 'exact' })

  // Filtre statut macro (toutes les "terminees")
  query = query.in('status', ['to_invoice', 'completed', 'cancelled'])

  // Filtre archives (toggle)
  if (!includeArchived) {
    query = query.is('archived_at', null)
  }

  // Filtre statut precis
  switch (statusFilter) {
    case 'to_invoice':
      query = query.eq('status', 'to_invoice')
      break
    case 'invoiced':
      query = query.eq('status', 'completed').not('invoiced_at', 'is', null)
      break
    case 'no_charge':
      query = query.eq('status', 'completed').not('no_charge_at', 'is', null)
      break
    case 'cancelled':
      query = query.eq('status', 'cancelled')
      break
    case 'archived':
      query = query.not('archived_at', 'is', null)
      break
    // 'all' = pas de filtre additionnel
  }

  if (source) query = query.eq('source', source)
  if (q) {
    const ors = [
      `external_id.ilike.%${q}%`,
      `dossier_number.ilike.%${q}%`,
      `client_name.ilike.%${q}%`,
      `vehicle_plate.ilike.%${q}%`,
      `invoice_number.ilike.%${q}%`,
    ]
    // Si q est numerique, on cherche aussi sur mission_number (cast text).
    if (/^\d+$/.test(q)) ors.push(`mission_number::text.ilike.%${q}%`)
    query = query.or(ors.join(','))
  }

  query = query
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('received_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sources distinctes pour le filtre (cap a 200 lignes scan, ok pour terminees)
  const { data: sources } = await sb
    .from('incoming_missions')
    .select('source')
    .in('status', ['to_invoice', 'completed', 'cancelled'])
    .not('source', 'is', null)
    .limit(1000)
  const uniqueSources = Array.from(new Set((sources || []).map(s => s.source).filter(Boolean)))

  // Comptes par categorie (pour les chips) — exclut toujours les archives sauf si toggle
  const baseCountQuery = () => {
    let qB = sb.from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['to_invoice', 'completed', 'cancelled'])
    if (!includeArchived) qB = qB.is('archived_at', null)
    return qB
  }

  const [
    { count: cAll },
    { count: cToInvoice },
    { count: cInvoiced },
    { count: cNoCharge },
    { count: cCancelled },
    { count: cArchived },
  ] = await Promise.all([
    baseCountQuery(),
    baseCountQuery().eq('status', 'to_invoice'),
    baseCountQuery().eq('status', 'completed').not('invoiced_at', 'is', null),
    baseCountQuery().eq('status', 'completed').not('no_charge_at', 'is', null),
    baseCountQuery().eq('status', 'cancelled'),
    sb.from('incoming_missions').select('id', { count: 'exact', head: true }).not('archived_at', 'is', null),
  ])

  return NextResponse.json({
    missions: data || [],
    total:    count || 0,
    page,
    pageSize: PAGE_SIZE,
    sources:  uniqueSources.sort(),
    counts: {
      all:        cAll || 0,
      to_invoice: cToInvoice || 0,
      invoiced:   cInvoiced || 0,
      no_charge:  cNoCharge || 0,
      cancelled:  cCancelled || 0,
      archived:   cArchived || 0,
    },
  })
}

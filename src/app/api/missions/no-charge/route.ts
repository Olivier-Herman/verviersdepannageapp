// src/app/api/missions/no-charge/route.ts
//
// POST /api/missions/no-charge
// Body : { mission_ids: string[]; reason: string }
//
// Marque une ou plusieurs missions comme "intervention sans frais".
// La mission passe au statut 'completed' (comme apres facturation) avec
// no_charge_at + no_charge_reason + no_charge_by. Elle sort de la queue
// facturation et devient archivable J+7.
//
// Acces : role admin/superadmin OU module 'facturation'.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MIN_REASON_LENGTH = 4

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { mission_ids?: string[]; reason?: string }
  const ids = Array.isArray(body.mission_ids)
    ? body.mission_ids.filter(x => typeof x === 'string' && x.length > 0)
    : []
  const reason = (body.reason || '').trim()

  if (ids.length === 0) {
    return NextResponse.json({ error: 'mission_ids manquant' }, { status: 400 })
  }
  if (reason.length < MIN_REASON_LENGTH) {
    return NextResponse.json(
      { error: `Motif requis (min ${MIN_REASON_LENGTH} caracteres)` },
      { status: 400 },
    )
  }

  const sb = createAdminClient()

  const { data: rows, error: fetchErr } = await sb
    .from('incoming_missions')
    .select('id, status, external_id')
    .in('id', ids)
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if ((rows || []).length !== ids.length) {
    return NextResponse.json({ error: 'Une ou plusieurs missions introuvables' }, { status: 404 })
  }

  const notReady = (rows || []).filter(r => r.status !== 'to_invoice')
  if (notReady.length > 0) {
    return NextResponse.json({
      error: `Statut invalide pour : ${notReady.map(r => r.external_id || r.id.slice(0, 8)).join(', ')} (attendu: to_invoice)`,
    }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await sb
    .from('incoming_missions')
    .update({
      status:           'completed',
      no_charge_at:     now,
      no_charge_reason: reason,
      no_charge_by:     user.id,
      // On force ces champs a null pour la coherence : pas de facture
      invoice_method:   null,
      invoice_number:   null,
      invoice_odoo_id:  null,
      invoice_url:      null,
    })
    .in('id', ids)
    .select('id, status, no_charge_at, no_charge_reason')
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const logRows = ids.map(id => ({
    mission_id: id,
    actor_id:   user.id,
    action:     'no_charge',
    notes:      `Intervention sans frais : ${reason}`,
    metadata:   { reason },
  }))
  await sb.from('mission_logs').insert(logRows)

  return NextResponse.json({ ok: true, updated })
}

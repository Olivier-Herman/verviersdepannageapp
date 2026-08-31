// src/app/api/missions/[id]/duplicate/route.ts
//
// POST — duplique une mission. Copie le CONTENU (véhicule, client, adresses,
// source, tarif…) dans une NOUVELLE fiche, en réinitialisant tout le cycle de
// vie (statut, pointages, Odoo/Kaze, paiement, parc, photos…).
// Olivier 2026-07-14.
//
// Accès : superadmin, ou permission « duplicate_mission » attribuée dans
// /admin/users. Olivier 2026-08-31 : le bouton devait s'ouvrir à un dispatcher
// (Jona) sans lui donner le superadmin — donc une permission nommée, pas un
// nom en dur ni l'ouverture à tout un rôle.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic = 'force-dynamic'

// Champs à NE PAS recopier (identité, cycle de vie, liens externes, uniques…).
const RESET_FIELDS = [
  'id', 'mission_number', 'created_at', 'updated_at',
  'external_id', 'source_email_id', 'source_format',
  'status', 'dispatch_mode', 'assigned_to',
  'driver_photos', 'client_signature', 'client_signature_name', 'recipient_signature',
  'discharge_data', 'discharge_motif', 'discharge_name', 'discharge_sig',
  'dpr_motif', 'dpr_motif_label', 'dpr_converted_from_rem',
  'payment_amount', 'payment_mode', 'payment_reference',
  'parc_zone_key', 'parc_row_number', 'parc_slot_index', 'park_stage_id', 'park_stage_name',
  'odoo_task_id', 'odoo_ticket_id', 'odoo_quote_id', 'odoo_quote_url', 'odoo_vehicle_id',
  'kaze_job_id', 'kaze_proposal_id', 'rel_kaze_job_id',
  'merged_into_mission_id', 'parent_mission_id',
  'invoice_number', 'invoice_odoo_id', 'archived_at',
  'garage_reopen_date', 'vehicle_mileage', 'closing_notes',
  'awaiting_payment', 'amount_to_collect_manual', 'touring_accepted_at',
  'is_rollable', 'photo_categories_covered', 'parse_confidence', 'raw_content',
]

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!sessionAccess(session, { roles: ['superadmin'], modules: ['duplicate_mission'] }).ok) {
    return NextResponse.json({ error: 'Duplication non autorisée' }, { status: 403 })
  }
  const actorId = (session.user as any)?.id || null

  const sb = createAdminClient()
  const { data: src, error } = await sb.from('incoming_missions').select('*').eq('id', params.id).single()
  if (error || !src) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const copy: Record<string, any> = { ...src }
  // Réinitialise le cycle de vie : tous les timestamps *_at + la liste RESET.
  for (const k of Object.keys(copy)) if (k.endsWith('_at')) delete copy[k]
  for (const k of RESET_FIELDS) delete copy[k]

  const now = new Date().toISOString()
  copy.external_id       = `DUP-${Date.now()}`
  copy.status            = 'dispatching'   // prête à dispatcher
  copy.received_at       = now
  copy.intervention_date = now

  const { data: created, error: insErr } = await sb
    .from('incoming_missions').insert(copy).select('id, mission_number').single()
  if (insErr) return NextResponse.json({ error: `Duplication KO : ${insErr.message}` }, { status: 500 })

  const srcRef = (src as any).mission_number != null ? `#${(src as any).mission_number}` : params.id.slice(0, 8)
  await sb.from('mission_logs').insert([
    { mission_id: created.id, actor_id: actorId, action: 'created', notes: `Fiche dupliquée depuis ${srcRef} (superadmin)`, metadata: { duplicated_from: params.id } },
    { mission_id: params.id,  actor_id: actorId, action: 'note',    notes: `Dupliquée → nouvelle fiche #${created.mission_number ?? created.id.slice(0, 8)}`, metadata: { duplicate_id: created.id } },
  ]).then(() => {}, () => {})

  return NextResponse.json({ ok: true, id: created.id, mission_number: created.mission_number })
}

// src/app/api/missions/[id]/merge/route.ts
//
// Fusion de fiches en double (même intervention, deux fiches).
//   GET  → fiches candidates (même plaque, autres, non annulées) à fusionner.
//   POST → fusionne { secondary_mission_id } DANS cette fiche (= principale).
//
// Décisions (Olivier 2026-06-17) :
//   - La fiche sur laquelle on agit (params.id) est la PRINCIPALE conservée :
//     elle garde son id, son parc/étiquette/encaissement, ses photos, son
//     chauffeur, ses pointages.
//   - La source de la principale est CONSERVÉE (ex. police_accident) ; on
//     rapatrie seulement le PAYEUR + infos assistance depuis la secondaire.
//   - La secondaire est soft-cancel (jamais supprimée) + merged_into_mission_id.
//
// Réservé au staff dispatch (admin/superadmin/dispatcher/fourrière).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['admin', 'superadmin', 'dispatcher']
function canAccess(session: any): boolean {
  if (!session) return false
  const role = (session.user as any)?.role || ''
  const modules: string[] = (session.user as any)?.modules || []
  return ALLOWED_ROLES.includes(role) || modules.includes('fourriere')
}

const norm = (s: string) => (s || '').replace(/[-.\s]/g, '').toUpperCase()

// ── GET : candidats de fusion (même plaque) ─────────────────────────────────
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: me } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate')
    .eq('id', params.id)
    .single()
  if (!me?.vehicle_plate) return NextResponse.json({ candidates: [] })

  const { data: all } = await sb
    .from('incoming_missions')
    .select('id, mission_number, source, status, mission_type, vehicle_plate, vehicle_brand, vehicle_model, client_name, billed_to_name, dossier_number, incident_address, received_at')
    .neq('id', params.id)
    .not('status', 'in', '(cancelled,ignored)')
    .is('merged_into_mission_id', null)
    .order('received_at', { ascending: false })
    .limit(50)

  const plate = norm(me.vehicle_plate)
  const candidates = (all || []).filter(m => m.vehicle_plate && norm(m.vehicle_plate) === plate)
  return NextResponse.json({ candidates })
}

// ── POST : fusionne secondary DANS params.id (principale) ────────────────────
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const secondaryId = body.secondary_mission_id ? String(body.secondary_mission_id) : null
  if (!secondaryId) return NextResponse.json({ error: 'secondary_mission_id requis' }, { status: 400 })
  if (secondaryId === params.id) return NextResponse.json({ error: 'Une fiche ne peut pas être fusionnée avec elle-même' }, { status: 400 })

  const sb = createAdminClient()
  const actorEmail = (session!.user as any)?.email || null
  const { data: actor } = actorEmail
    ? await sb.from('users').select('id').eq('email', actorEmail).single()
    : { data: null as any }

  const cols = 'id, mission_number, source, status, billed_to_id, billed_to_name, dossier_number, amount_guaranteed, client_name, client_phone, driver_photos, remarks_general, merged_into_mission_id, vehicle_plate'
  const [{ data: master }, { data: secondary }] = await Promise.all([
    sb.from('incoming_missions').select(cols).eq('id', params.id).single(),
    sb.from('incoming_missions').select(cols).eq('id', secondaryId).single(),
  ])
  if (!master)    return NextResponse.json({ error: 'Fiche principale introuvable' }, { status: 404 })
  if (!secondary) return NextResponse.json({ error: 'Fiche à fusionner introuvable' }, { status: 404 })
  if (secondary.status === 'cancelled' || secondary.merged_into_mission_id)
    return NextResponse.json({ error: 'Cette fiche est déjà annulée ou fusionnée' }, { status: 409 })

  // ── Construire les màj de la principale (source CONSERVÉE) ────────────────
  const upd: Record<string, any> = { updated_at: new Date().toISOString() }
  // Payeur = assistance : on prend celui de la secondaire s'il existe.
  if (secondary.billed_to_id || secondary.billed_to_name) {
    upd.billed_to_id   = secondary.billed_to_id   ?? master.billed_to_id ?? null
    upd.billed_to_name = secondary.billed_to_name ?? master.billed_to_name ?? null
  }
  // Champs qui comblent les trous de la principale uniquement.
  const fillIfEmpty: [string, any, any][] = [
    ['dossier_number',   master.dossier_number,   secondary.dossier_number],
    ['amount_guaranteed', master.amount_guaranteed, secondary.amount_guaranteed],
    ['client_name',      master.client_name,      secondary.client_name],
    ['client_phone',     master.client_phone,     secondary.client_phone],
  ]
  for (const [field, cur, fromSec] of fillIfEmpty) {
    if ((cur == null || cur === '') && fromSec != null && fromSec !== '') upd[field] = fromSec
  }
  // Photos : union (la principale garde les siennes + celles de la secondaire).
  const masterPhotos = Array.isArray(master.driver_photos) ? master.driver_photos : []
  const secPhotos    = Array.isArray(secondary.driver_photos) ? secondary.driver_photos : []
  const mergedPhotos = Array.from(new Set([...masterPhotos, ...secPhotos]))
  if (mergedPhotos.length > masterPhotos.length) upd.driver_photos = mergedPhotos
  // Remarques : on annexe une note de fusion.
  const secRef = secondary.mission_number != null ? `#${secondary.mission_number}` : secondaryId.slice(0, 8)
  const note   = `— Fusion de la fiche ${secRef} (${secondary.source}) le ${new Date().toISOString().slice(0, 10)}`
  upd.remarks_general = [master.remarks_general, note].filter(Boolean).join('\n')

  const { error: updErr } = await sb.from('incoming_missions').update(upd).eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // ── Soft-cancel de la secondaire + lien vers la principale ────────────────
  const masterRef = master.mission_number != null ? `#${master.mission_number}` : params.id.slice(0, 8)
  const { error: secErr } = await sb.from('incoming_missions').update({
    status:                  'cancelled',
    merged_into_mission_id:  params.id,
    closing_notes:           `Fusionnée dans ${masterRef}`,
    updated_at:              new Date().toISOString(),
  }).eq('id', secondaryId).eq('status', secondary.status)  // garde anti-course
  if (secErr) return NextResponse.json({ error: secErr.message }, { status: 500 })

  // ── Traces ────────────────────────────────────────────────────────────────
  await sb.from('mission_logs').insert([
    { mission_id: params.id,   actor_id: actor?.id ?? null, action: 'merge_in', notes: `Fiche ${secRef} fusionnée dans celle-ci`, metadata: { secondary_id: secondaryId, fields: Object.keys(upd) } },
    { mission_id: secondaryId, actor_id: actor?.id ?? null, action: 'merged',   notes: `Fusionnée dans ${masterRef}`,            metadata: { master_id: params.id } },
  ])

  return NextResponse.json({ ok: true, master_id: params.id, secondary_id: secondaryId })
}

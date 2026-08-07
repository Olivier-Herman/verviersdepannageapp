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

  // Olivier 2026-06-24 : on filtre la PLAQUE dans la requête SQL (et pas après
  // un limit global) — sinon une fiche plus ancienne (ex. appel police déjà en
  // parc) sortait du top 50 récent et n'était jamais proposée à la fusion.
  // ilike tolérant aux séparateurs : "2BNG325" matche "2-BNG-325", "2 BNG 325"…
  const plate = norm(me.vehicle_plate)
  const likePattern = '%' + plate.split('').join('%') + '%'

  const { data: all } = await sb
    .from('incoming_missions')
    .select('id, mission_number, source, status, mission_type, vehicle_plate, vehicle_brand, vehicle_model, client_name, billed_to_name, dossier_number, incident_address, received_at')
    .neq('id', params.id)
    .not('status', 'in', '(cancelled,ignored)')
    .is('merged_into_mission_id', null)
    .ilike('vehicle_plate', likePattern)
    .order('received_at', { ascending: false })
    .limit(50)

  // Filtre exact (plaque normalisée) pour écarter les faux positifs de l'ilike.
  const candidates = (all || []).filter(m => m.vehicle_plate && norm(m.vehicle_plate) === plate)
  return NextResponse.json({ candidates })
}

// ── POST : fusionne secondary DANS params.id (principale) ────────────────────
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const otherId = (body.other_mission_id || body.secondary_mission_id)
    ? String(body.other_mission_id || body.secondary_mission_id) : null
  if (!otherId) return NextResponse.json({ error: 'other_mission_id requis' }, { status: 400 })
  if (otherId === params.id) return NextResponse.json({ error: 'Une fiche ne peut pas être fusionnée avec elle-même' }, { status: 400 })

  const sb = createAdminClient()
  const actorEmail = (session!.user as any)?.email || null
  const { data: actor } = actorEmail
    ? await sb.from('users').select('id').eq('email', actorEmail).single()
    : { data: null as any }

  const cols = 'id, mission_number, source, status, billed_to_id, billed_to_name, dossier_number, amount_guaranteed, client_name, client_phone, driver_photos, remarks_general, merged_into_mission_id, vehicle_plate, received_at, assigned_to, parc_zone_key, destination_name, destination_address, destination_lat, destination_lng'
  const [{ data: a }, { data: b }] = await Promise.all([
    sb.from('incoming_missions').select(cols).eq('id', params.id).single(),
    sb.from('incoming_missions').select(cols).eq('id', otherId).single(),
  ])
  if (!a || !b) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  for (const m of [a, b]) {
    if (m.status === 'cancelled' || m.merged_into_mission_id)
      return NextResponse.json({ error: 'Une des fiches est déjà annulée ou fusionnée' }, { status: 409 })
  }

  // ── Déterminer la fiche à CONSERVER (principale) ──────────────────────────
  // Olivier 2026-06-29 : la principale est TOUJOURS la plus ancienne (received_at).
  // Sa source ET son heure/date d'intervention sont préservées → le prix
  // (majoration horaire) ne change pas à la fusion. La plus récente est absorbée.
  let master: any, secondary: any
  const aTime = new Date(a.received_at || 0).getTime()
  const bTime = new Date(b.received_at || 0).getTime()
  master    = aTime <= bTime ? a : b
  secondary = master.id === a.id ? b : a

  // ── Construire les màj de la principale (source CONSERVÉE) ────────────────
  const upd: Record<string, any> = { updated_at: new Date().toISOString() }
  // Payeur = assistance : on prend celui de la secondaire s'il existe.
  if (secondary.billed_to_id || secondary.billed_to_name) {
    upd.billed_to_id   = secondary.billed_to_id   ?? master.billed_to_id ?? null
    upd.billed_to_name = secondary.billed_to_name ?? master.billed_to_name ?? null
  }
  // N° de dossier : on AJOUTE celui de la secondaire (assistance) à celui de la
  // principale (police), au lieu de seulement combler si vide. Les deux sont
  // conservés, séparés par « / ». Pas de doublon si déjà présent.
  const mDoss = (master.dossier_number || '').trim()
  const sDoss = (secondary.dossier_number || '').trim()
  if (sDoss && !mDoss) {
    upd.dossier_number = sDoss
  } else if (sDoss && mDoss && !mDoss.split(/\s*\/\s*/).includes(sDoss)) {
    upd.dossier_number = `${mDoss} / ${sDoss}`
  }
  // Autres champs : comblent les trous de la principale uniquement.
  const fillIfEmpty: [string, any, any][] = [
    ['amount_guaranteed', master.amount_guaranteed, secondary.amount_guaranteed],
    ['client_name',      master.client_name,      secondary.client_name],
    ['client_phone',     master.client_phone,     secondary.client_phone],
  ]
  for (const [field, cur, fromSec] of fillIfEmpty) {
    if ((cur == null || cur === '') && fromSec != null && fromSec !== '') upd[field] = fromSec
  }
  // Destination : la secondaire (fiche la plus récente = 2e jambe d'un tow splitté,
  // ex. dépôt→garage chez Kaze) porte la destination FINALE → elle ÉCRASE celle de
  // la principale (qui gardait une destination intermédiaire, ex. le dépôt).
  // L'incident de la principale (1re jambe) reste inchangé. Olivier 2026-08-07.
  if (secondary.destination_address && secondary.destination_address !== master.destination_address) {
    upd.destination_address = secondary.destination_address
    upd.destination_name    = secondary.destination_name ?? null
    upd.destination_lat     = secondary.destination_lat ?? null
    upd.destination_lng     = secondary.destination_lng ?? null
  }
  // Photos : union (la principale garde les siennes + celles de la secondaire).
  const masterPhotos = Array.isArray(master.driver_photos) ? master.driver_photos : []
  const secPhotos    = Array.isArray(secondary.driver_photos) ? secondary.driver_photos : []
  const mergedPhotos = Array.from(new Set([...masterPhotos, ...secPhotos]))
  if (mergedPhotos.length > masterPhotos.length) upd.driver_photos = mergedPhotos
  // Remarques : on annexe une note de fusion.
  const secRef = secondary.mission_number != null ? `#${secondary.mission_number}` : secondary.id.slice(0, 8)
  const note   = `— Fusion de la fiche ${secRef} (${secondary.source}) le ${new Date().toISOString().slice(0, 10)}`
  upd.remarks_general = [master.remarks_general, note].filter(Boolean).join('\n')

  const { error: updErr } = await sb.from('incoming_missions').update(upd).eq('id', master.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // ── Soft-cancel de la secondaire + lien vers la principale ────────────────
  const masterRef = master.mission_number != null ? `#${master.mission_number}` : master.id.slice(0, 8)
  const { error: secErr } = await sb.from('incoming_missions').update({
    status:                  'cancelled',
    merged_into_mission_id:  master.id,
    closing_notes:           `Fusionnée dans ${masterRef}`,
    updated_at:              new Date().toISOString(),
  }).eq('id', secondary.id).eq('status', secondary.status)  // garde anti-course
  if (secErr) return NextResponse.json({ error: secErr.message }, { status: 500 })

  // ── Conserver l'historique de la fiche fusionnée sur la principale ────────
  // Olivier 2026-06-29 : avant, les logs de la secondaire restaient sur la fiche
  // cachée → la principale ne montrait qu'une ligne « fusion » et l'historique
  // initial disparaissait. On rattache désormais les logs de la secondaire à la
  // principale (timestamps préservés) pour garder l'historique complet, classé
  // chronologiquement avec celui de la principale.
  await sb.from('mission_logs').update({ mission_id: master.id }).eq('mission_id', secondary.id)
    .then(() => {}, (e) => console.error('[merge] reparent logs KO:', e?.message))

  // ── Traces ────────────────────────────────────────────────────────────────
  await sb.from('mission_logs').insert([
    { mission_id: master.id,    actor_id: actor?.id ?? null, action: 'merge_in', notes: `Fiche ${secRef} fusionnée dans celle-ci`, metadata: { secondary_id: secondary.id, fields: Object.keys(upd) } },
    { mission_id: secondary.id, actor_id: actor?.id ?? null, action: 'merged',   notes: `Fusionnée dans ${masterRef}`,            metadata: { master_id: master.id } },
  ])

  return NextResponse.json({ ok: true, master_id: master.id, master_ref: masterRef, secondary_id: secondary.id })
}

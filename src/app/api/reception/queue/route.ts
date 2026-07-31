// Console réception : file d'attente des visiteurs (competence-filtrée) + actions.
// GET  → { me, priv, staff, items }
// POST { action:'claim'|'complete'|'reassign', id, note?, user_id? }
// Accès : session. Chrono de service exposé au superadmin uniquement.
// Olivier 2026-07-31.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const STAFF_ROLES = ['dispatcher', 'admin', 'superadmin']
const isStaff = (u: any) => (u?.roles?.length ? u.roles : [u?.role]).filter(Boolean).some((r: string) => STAFF_ROLES.includes(r))
const isPriv  = (u: any) => u?.role === 'superadmin' || (u?.roles || []).includes('superadmin') || u?.role === 'admin' || (u?.roles || []).includes('admin')

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  const priv = isPriv(me)
  const sb = createAdminClient()

  // Compétences de l'utilisateur (motifs qu'il traite).
  let myMotifs: string[] = []
  if (!priv) {
    const { data } = await sb.from('user_competences').select('motif_id').eq('user_id', me.id)
    myMotifs = (data || []).map((r: any) => r.motif_id)
  }

  const since = new Date(Date.now() - 24 * 3600e3).toISOString()
  let q = sb.from('fiche_interactions')
    .select('id, status, visitor_name, phone, email, lang, motif_id, motif_label, mission_id, contact_id, note, waiting_since, started_at, handled_by, created_at')
    .eq('type', 'visit').in('status', ['waiting', 'in_progress']).gte('created_at', since)
    .order('waiting_since', { ascending: true })
  if (!priv) {
    if (!myMotifs.length) return NextResponse.json({ me: me.id, priv, staff: [], items: [] })
    q = q.in('motif_id', myMotifs)
  }
  const { data: rows } = await q

  const list = rows || []
  const missionIds = [...new Set(list.map(r => r.mission_id).filter(Boolean))]
  const motifIds   = [...new Set(list.map(r => r.motif_id).filter(Boolean))]
  const userIds    = [...new Set(list.map(r => r.handled_by).filter(Boolean))]

  const [missions, motifs, users, staffUsers] = await Promise.all([
    missionIds.length ? sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key').in('id', missionIds) : Promise.resolve({ data: [] }),
    motifIds.length   ? sb.from('reception_motifs').select('id, color, section').in('id', motifIds) : Promise.resolve({ data: [] }),
    userIds.length    ? sb.from('users').select('id, name').in('id', userIds) : Promise.resolve({ data: [] }),
    sb.from('users').select('id, name, role, roles').order('name'),
  ])
  const mById = new Map((missions.data || []).map((m: any) => [m.id, m]))
  const moById = new Map((motifs.data || []).map((m: any) => [m.id, m]))
  const uById = new Map((users.data || []).map((u: any) => [u.id, u.name]))

  const now = Date.now()
  const items = list.map(r => {
    const mm = r.mission_id ? mById.get(r.mission_id) : null
    const mo = r.motif_id ? moById.get(r.motif_id) : null
    return {
      id: r.id, status: r.status,
      visitor: r.visitor_name || r.phone || r.email || '—',
      phone: r.phone, email: r.email, lang: r.lang,
      motif: r.motif_label, motif_color: mo?.color || null, section: mo?.section || null,
      waiting_since: r.waiting_since, note: r.note,
      handled_by: r.handled_by, handler: r.handled_by ? (uById.get(r.handled_by) || '—') : null,
      mine: r.handled_by === me.id,
      mission_id: r.mission_id || null,
      mission: mm ? { number: mm.mission_number, plate: mm.vehicle_plate, vehicle: [mm.vehicle_brand, mm.vehicle_model].filter(Boolean).join(' ') || null, zone: mm.parc_zone_key } : null,
      // Chrono de service : superadmin uniquement.
      serviceSec: priv && r.started_at ? Math.max(0, Math.round((now - Date.parse(r.started_at)) / 1000)) : null,
    }
  })

  const staff = (staffUsers.data || []).filter((u: any) => isStaff(u) && u.role !== 'inactive').map((u: any) => ({ id: u.id, name: u.name }))
  return NextResponse.json({ me: me.id, priv, staff, items })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const sb = createAdminClient()
  const now = new Date().toISOString()

  if (action === 'claim') {
    const { data } = await sb.from('fiche_interactions').select('status, started_at').eq('id', id).maybeSingle()
    if (!data || data.status === 'done') return NextResponse.json({ error: 'Visite indisponible' }, { status: 409 })
    await sb.from('fiche_interactions').update({
      status: 'in_progress', handled_by: me.id, started_at: data.started_at || now,
    }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'complete') {
    const note = String(body.note || '').trim() || null
    const { data: it } = await sb.from('fiche_interactions').select('mission_id, motif_label, note').eq('id', id).maybeSingle()
    await sb.from('fiche_interactions').update({
      status: 'done', ended_at: now, handled_by: me.id,
      note: note ?? it?.note ?? null,
    }).eq('id', id)
    // Trace dans la fiche véhicule si rattachée.
    if (it?.mission_id) {
      await sb.from('mission_logs').insert({
        mission_id: it.mission_id, actor_id: me.id, action: 'reception_visit',
        notes: `Visite accueil — ${it.motif_label || 'motif ?'}${note ? ` : ${note}` : ''}`,
        metadata: { source: 'reception', interaction_id: id },
      }).then(() => {}, () => {})
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'link') {
    const missionId = String(body.mission_id || '')
    if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
    await sb.from('fiche_interactions').update({ mission_id: missionId }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'reassign') {
    const userId = String(body.user_id || '')
    if (!userId) return NextResponse.json({ error: 'user_id requis' }, { status: 400 })
    const { data: it } = await sb.from('fiche_interactions').select('handled_by').eq('id', id).maybeSingle()
    await sb.from('fiche_interactions').update({
      handled_by: userId, substituted_from: it?.handled_by || me.id,
    }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}

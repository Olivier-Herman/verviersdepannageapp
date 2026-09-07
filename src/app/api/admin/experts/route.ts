// src/app/api/admin/experts/route.ts
//
// Administration des ACCÈS EXPERTS (page publique /expert, QR A4 à l'accueil).
//   GET  → { devices, recipients, candidates }
//          devices    : téléphones inscrits + bureaux (statut) + visites
//          recipients : ids des comptes qui reçoivent les popups experts
//                       (app_settings `expert_access_recipients`)
//          candidates : comptes bureau proposés comme destinataires
//   POST { action: 'bureau',         id, status: 'approved'|'refused'|'revoked' }
//        { action: 'revoke_device',  id }        → l'appareil est révoqué (clé morte)
//        { action: 'restore_device', id }
//        { action: 'recipients',     ids: string[] }
// Réservé admin/superadmin. Olivier 2026-09-07.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const OFFICE_ROLES = ['dispatcher', 'admin', 'superadmin']

function requireAdmin(session: any): boolean {
  return ['admin', 'superadmin'].includes(session?.user?.role || '')
    || (Array.isArray(session?.user?.roles) && session.user.roles.some((r: string) => ['admin', 'superadmin'].includes(r)))
}

async function snapshot(sb: any) {
  const [{ data: devices }, { data: bureaus }, { data: visits }, { data: setting }, { data: users }] = await Promise.all([
    sb.from('expert_devices').select('id, first_name, user_agent, created_at, last_seen_at, revoked_at, revoked_by').order('created_at', { ascending: false }),
    sb.from('expert_device_bureaus').select('id, device_id, bureau, status, requested_at, decided_at, decided_by').order('requested_at', { ascending: true }),
    sb.from('mission_visitors').select('expert_device_id, visited_at, mission_id').not('expert_device_id', 'is', null).order('visited_at', { ascending: false }),
    sb.from('app_settings').select('value').eq('key', 'expert_access_recipients').maybeSingle(),
    sb.from('users').select('id, name, role, roles, active').eq('active', true).order('name'),
  ])
  const nameOf = new Map<string, string>((users || []).map((u: any) => [u.id, u.name]))
  const byDevice = new Map<string, any[]>()
  for (const b of bureaus || []) {
    const list = byDevice.get(b.device_id) || []
    list.push({ ...b, decided_by_name: b.decided_by ? (nameOf.get(b.decided_by) || '—') : null })
    byDevice.set(b.device_id, list)
  }
  const visitsByDevice = new Map<string, { count: number; last: string | null; missions: Set<string> }>()
  for (const v of visits || []) {
    const cur = visitsByDevice.get(v.expert_device_id) || { count: 0, last: null, missions: new Set<string>() }
    cur.count++; cur.missions.add(v.mission_id); if (!cur.last) cur.last = v.visited_at
    visitsByDevice.set(v.expert_device_id, cur)
  }
  let recipients: string[] = []
  try {
    const v = setting?.value
    const parsed = typeof v === 'string' ? JSON.parse(v) : v
    if (Array.isArray(parsed)) recipients = parsed.map(String)
  } catch { /* illisible → vide */ }
  const candidates = (users || [])
    .filter((u: any) => [u.role, ...(Array.isArray(u.roles) ? u.roles : [])].some((r: string) => OFFICE_ROLES.includes(r)))
    .map((u: any) => ({ id: u.id, name: u.name, role: u.role }))
  return {
    devices: (devices || []).map((d: any) => {
      const vs = visitsByDevice.get(d.id)
      return {
        ...d, revoked_by_name: d.revoked_by ? (nameOf.get(d.revoked_by) || '—') : null,
        bureaus: byDevice.get(d.id) || [],
        visits: vs?.count || 0, vehicles: vs?.missions.size || 0, last_visit_at: vs?.last || null,
      }
    }),
    recipients, candidates,
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return NextResponse.json(await snapshot(createAdminClient()))
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const me = (session.user as any).id || null
  const meName = (session.user as any).name || 'admin'
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({})) as any
  const now = new Date().toISOString()
  const id = String(body.id || '')

  switch (String(body.action || '')) {
    case 'bureau': {
      const status = ['approved', 'refused', 'revoked'].includes(body.status) ? body.status : null
      if (!id || !status) return NextResponse.json({ error: 'id + status (approved | refused | revoked) requis' }, { status: 400 })
      const { data: row } = await sb.from('expert_device_bureaus').select('id, device_id, bureau, status').eq('id', id).maybeSingle()
      if (!row) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
      const { error } = await sb.from('expert_device_bureaus').update({ status, decided_at: now, decided_by: me }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      // Ferme les popups encore ouverts pour cette demande (tous destinataires).
      await sb.from('notifications_log')
        .update({ responded_at: now, read_at: now, response: { admin: meName, status } })
        .eq('notif_type', 'expert_access').is('responded_at', null)
        .filter('payload->data->items', 'cs', JSON.stringify([{ request_id: id }]))
        .then(() => {}, () => {})
      break
    }
    case 'revoke_device':
    case 'restore_device': {
      if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
      const revoke = body.action === 'revoke_device'
      const { error } = await sb.from('expert_devices')
        .update(revoke ? { revoked_at: now, revoked_by: me } : { revoked_at: null, revoked_by: null }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (revoke) {
        await sb.from('expert_device_bureaus').update({ status: 'revoked', decided_at: now, decided_by: me })
          .eq('device_id', id).in('status', ['approved', 'pending'])
      }
      break
    }
    case 'recipients': {
      const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
      const { error } = await sb.from('app_settings').upsert({ key: 'expert_access_recipients', value: JSON.stringify(ids) }, { onConflict: 'key' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      break
    }
    default:
      return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, ...(await snapshot(sb)) })
}

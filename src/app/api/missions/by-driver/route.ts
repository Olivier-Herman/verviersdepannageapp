// src/app/api/missions/by-driver/route.ts
//
// GET ?driver=<user id>&before=<ISO>&limit=100 — toutes les missions d'un
// chauffeur, la plus récente en haut (Olivier 22/09/2026 : « je sélectionne le
// chauffeur et tu m'affiches toutes ses missions »). Pagination par curseur
// sur la date de référence (attribution, sinon réception).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const FIELDS = 'id, mission_number, status, mission_type, incident_type, source, vehicle_plate, vehicle_brand, vehicle_model, client_name, incident_city, incident_address, destination_address, assigned_at, received_at, intervention_date, on_site_at, completed_at, cancelled_at, parked_at, invoice_number, invoice_method, dossier_number, parent_mission_id, estimated_htva'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  const role: string = u.role || ''
  const roles: string[] = u.roles || [role]
  const modules: string[] = u.modules || []
  const ok = ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r)) || modules.includes('missions') || modules.includes('dispatch')
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const driver = String(url.searchParams.get('driver') || '').trim()
  const before = String(url.searchParams.get('before') || '').trim()
  const limit = Math.max(10, Math.min(200, Number(url.searchParams.get('limit')) || 100))
  if (!driver) return NextResponse.json({ error: 'driver requis' }, { status: 400 })

  const sb = createAdminClient()
  // Date de référence = attribution (sinon réception). On trie sur les deux
  // colonnes ; le curseur porte sur la date de référence calculée côté serveur.
  let q = sb.from('incoming_missions').select(FIELDS)
    .eq('assigned_to', driver).eq('dossier_leg', false)
    .order('assigned_at', { ascending: false, nullsFirst: false })
    .order('received_at', { ascending: false })
    .limit(limit + 1)
  if (before) q = q.lt('assigned_at', before)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data || []).map(m => ({ ...m, ref_at: m.assigned_at || m.received_at }))
  const more = rows.length > limit
  const page = more ? rows.slice(0, limit) : rows
  const { count } = await sb.from('incoming_missions').select('id', { count: 'exact', head: true }).eq('assigned_to', driver).eq('dossier_leg', false)
  return NextResponse.json({ ok: true, missions: page, more, next_before: more ? page[page.length - 1].assigned_at : null, total: count ?? null })
}

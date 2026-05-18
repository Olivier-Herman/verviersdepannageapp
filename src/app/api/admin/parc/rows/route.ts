// src/app/api/admin/parc/rows/route.ts
//
// GET     /api/admin/parc/rows         -> liste toutes les lignes (groupees par zone)
// POST    /api/admin/parc/rows         -> { zone_key, capacity } cree une nouvelle
//                                          ligne avec row_number auto-incremente
//
// Acces : admin / superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function ensureAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const ok = ['admin', 'superadmin'].some(r => roles.includes(r) || user.role === r)
  return ok ? user : null
}

export async function GET() {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const [{ data: zones }, { data: rows }] = await Promise.all([
    sb.from('parc_zones').select('*').order('sort_order'),
    sb.from('parc_rows').select('*').order('zone_key').order('row_number'),
  ])

  return NextResponse.json({
    zones: zones || [],
    rows:  rows  || [],
  })
}

export async function POST(req: Request) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const zoneKey  = String(body.zone_key || '').trim()
  const capacity = Number(body.capacity)

  if (!zoneKey || !Number.isInteger(capacity) || capacity <= 0) {
    return NextResponse.json({ error: 'zone_key et capacity (int > 0) requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Verifier que la zone existe
  const { data: zone } = await sb.from('parc_zones').select('key').eq('key', zoneKey).maybeSingle()
  if (!zone) return NextResponse.json({ error: `Zone inconnue: ${zoneKey}` }, { status: 400 })

  // Calculer le prochain row_number
  const { data: lastRow } = await sb
    .from('parc_rows')
    .select('row_number')
    .eq('zone_key', zoneKey)
    .order('row_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextNumber = (lastRow?.row_number || 0) + 1

  const { data: created, error } = await sb
    .from('parc_rows')
    .insert({ zone_key: zoneKey, row_number: nextNumber, capacity })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ row: created })
}

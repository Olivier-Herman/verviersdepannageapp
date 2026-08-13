// src/app/api/admin/boutades/route.ts
//
// GET — historique des boutades (vannes chauffeur). Superadmin uniquement (Mobi).
// Stocké à part (table `boutades`), n'apparaît pas sur les fiches. Olivier 2026-08-13.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function isSuperadmin(session: any): boolean {
  const role = session?.user?.role || ''
  const roles: string[] = Array.isArray(session?.user?.roles) ? session.user.roles : []
  return role === 'superadmin' || roles.includes('superadmin')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('boutades')
    .select('id, created_at, driver_name, text, via, vehicle, city, mission_id')
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ boutades: data || [] })
}

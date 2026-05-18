// src/app/api/admin/tarifs/sources/route.ts
//
// GET /api/admin/tarifs/sources
// Liste les sources actives du catalogue central (mission_source_catalog),
// utilisee par TarifsClient pour peupler onglets et dropdowns sans hardcoder.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  return session
}

export async function GET() {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const sb = createAdminClient()

  const { data, error } = await sb
    .from('mission_source_catalog')
    .select('key, label, active, sort_order')
    .eq('active', true)
    .order('sort_order')
    .order('label')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sources = (data || []).map(s => ({ source: s.key, label: s.label }))
  return NextResponse.json({ ok: true, sources })
}

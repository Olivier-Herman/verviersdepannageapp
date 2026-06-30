// src/app/api/admin/towsoft-create/route.ts
//
// Interrupteur de la création de fiche dans TowSoft.
//   GET  → { enabled }
//   POST { enabled } → met à jour (superadmin)
// Quand OFF : la mission VD Soft + le ticket Odoo continuent d'être créés, mais
// la fiche n'est plus poussée dans TowSoft. La lecture TowSoft reste active.
// Olivier 2026-06-30.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['admin', 'superadmin'].includes((session.user as any).role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const sb = createAdminClient()
  const { data } = await sb.from('app_settings').select('value').eq('key', 'towsoft_create').maybeSingle()
  const enabled = (data?.value as any)?.enabled !== false   // défaut = activé
  return NextResponse.json({ enabled })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'superadmin') {
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { enabled?: boolean }
  const enabled = body.enabled !== false
  const sb = createAdminClient()
  const { error } = await sb.from('app_settings').upsert(
    { key: 'towsoft_create', value: { enabled, updated_at: new Date().toISOString(), updated_by: (session.user as any).email } },
    { onConflict: 'key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, enabled })
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const supabase  = createAdminClient()
  const { ids }   = await req.json()
  await supabase.from('app_settings').upsert(
    { key: 'check_responsible_ids', value: JSON.stringify(ids), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  )
  return NextResponse.json({ ok: true })
}

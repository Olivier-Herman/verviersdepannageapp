// /api/users/me/work-mode — bouton Chauffeur / Dispatch (Olivier 05/11/2026).
// GET : le mode, et si la personne est de garde, à qui elle peut la passer. POST { mode, remplacant_id? } : change de mode.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { readWorkMode } from '@/lib/work-mode'

export const dynamic = 'force-dynamic'

async function remplacants(sb: ReturnType<typeof createAdminClient>, moi: string) {
  // Même règle que /api/dispatcher-on-duty pour pouvoir être de garde.
  const { data } = await sb.from('users').select('id, name').eq('active', true).is('work_mode', null).in('role', ['dispatcher', 'admin', 'superadmin']).neq('id', moi).order('name')
  return ((data || []) as any[]).filter(u => !/fusionn|apple review/i.test(u.name || ''))
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const work = await readWorkMode(u)
  if (!work.available) return NextResponse.json(work)
  const sb = createAdminClient()
  const { data: garde } = await sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle()
  const deGarde = garde?.user_id === u.id
  return NextResponse.json({ ...work, de_garde: deGarde, remplacants: deGarde ? await remplacants(sb, u.id) : [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  const work = await readWorkMode(u)
  if (!work.available) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const mode = b.mode === 'chauffeur' ? 'chauffeur' : 'dispatch'
  const sb = createAdminClient()

  if (mode === 'chauffeur') {
    // Le dispatcher de garde reçoit seul certaines alertes (dont l'appel d'escalade) : il passe la main avant.
    const { data: garde } = await sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle()
    if (garde?.user_id === u.id) {
      const liste = await remplacants(sb, u.id)
      if (!liste.some(r => r.id === b.remplacant_id)) return NextResponse.json({ error: 'Choisis qui prend le dispatch.' }, { status: 400 })
      const { error } = await sb.from('dispatcher_on_duty').update({ user_id: b.remplacant_id, set_at: new Date().toISOString(), set_by: u.id }).eq('id', 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }
  const { error } = await sb.from('users').update({ work_mode: mode === 'chauffeur' ? 'chauffeur' : null }).eq('id', u.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode })
}

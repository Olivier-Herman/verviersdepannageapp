// POST /api/missions/[id]/josiane { step } — trace qu'une apparition de Mamie Josiane a bien été affichée
// sur le téléphone (Olivier 15/10/2026 : savoir si Franck l'a vue). Journal seulement.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name').eq('email', session.user.email).maybeSingle()
  await sb.from('mission_logs').insert({ mission_id: params.id, actor_id: me?.id || null, action: 'josiane_vue', notes: `Mamie Josiane affichée à ${me?.name || 'le chauffeur'} (étape ${Number(b?.step) || '?'}${b?.ferme ? ', fermée par « Merci Mamie »' : ''}).`, metadata: { step: b?.step, ferme: !!b?.ferme } }).then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}

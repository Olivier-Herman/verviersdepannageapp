// src/app/api/profile/auth-providers/[id]/route.ts
//
// DELETE : dissocie un provider du user courant.
// Protection : refuse si c est la DERNIERE methode (un user doit toujours
// pouvoir se connecter par au moins une methode).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 401 })

  const sb = createAdminClient()

  // Verifier que le lien appartient bien a cet user
  const { data: link } = await sb
    .from('user_auth_providers')
    .select('id, user_id, provider')
    .eq('id', params.id)
    .maybeSingle()
  if (!link || link.user_id !== userId) {
    return NextResponse.json({ error: 'Lien introuvable' }, { status: 404 })
  }

  // Compter les methodes restantes (avec password_hash compte si credentials present)
  const { data: allLinks } = await sb
    .from('user_auth_providers')
    .select('id, provider')
    .eq('user_id', userId)

  const { data: u } = await sb
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .maybeSingle()

  const effective = (allLinks || []).filter(l => {
    if (l.provider === 'credentials' && !u?.password_hash) return false
    return true
  })

  if (effective.length <= 1) {
    return NextResponse.json({
      error: 'Impossible de dissocier la dernière méthode de connexion. Lie d\'abord une autre méthode.',
    }, { status: 400 })
  }

  // Si on dissocie credentials → on retire aussi le password_hash pour eviter incoherence
  if (link.provider === 'credentials') {
    await sb.from('users').update({ password_hash: null }).eq('id', userId)
  }

  const { error } = await sb.from('user_auth_providers').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

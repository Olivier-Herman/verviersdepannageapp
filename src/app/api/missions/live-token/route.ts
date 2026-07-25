// POST /api/missions/live-token
// Délivre un token signé au chauffeur connecté, que l'app iOS stocke dans l'App
// Group pour que les boutons de la Live Activity (App Intents) appellent
// /api/missions/live-action sans cookie de session. Olivier 2026-07-28.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { signLiveToken }    from '@/lib/native/liveToken'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: user } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()
  if (!user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  return NextResponse.json({ token: signLiveToken(user.id) })
}

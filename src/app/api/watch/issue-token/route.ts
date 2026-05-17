// src/app/api/watch/issue-token/route.ts
//
// POST /api/watch/issue-token  (auth: NextAuth session normale)
//
// Genere un JWT Watch (90j) pour le user courant. L iPhone l envoie
// a la Watch via WatchConnectivity. La Watch l utilise en
// Authorization: Bearer pour tous les /api/watch/*.
//
// Securite : seul l iPhone authentifie peut emettre. La Watch ne fait
// jamais cet appel elle-meme — sinon ca casserait l invariant
// "auth heritee de l iPhone via WatchConnectivity".

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { issueWatchToken }   from '@/lib/auth-watch'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let userId = (session.user as any).id as string | undefined
  if (!userId && session.user?.email) {
    const sb = createAdminClient()
    const { data } = await sb.from('users').select('id').eq('email', session.user.email).single()
    userId = data?.id
  }
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const { token, expires_at } = await issueWatchToken(userId)
  return NextResponse.json({ ok: true, token, expires_at })
}

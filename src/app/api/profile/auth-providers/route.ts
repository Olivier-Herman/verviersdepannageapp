// src/app/api/profile/auth-providers/route.ts
//
// GET : liste les methodes de connexion liees a l user courant.
// Retourne 4 entrees (les 4 providers possibles), avec leur etat lie/non-lie.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALL_PROVIDERS = ['apple', 'google', 'azure-ad', 'credentials'] as const
type ProviderKey = typeof ALL_PROVIDERS[number]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  // Resoud le user_id : prefere session.user.id, fallback lookup par email
  // (utile si le JWT est ancien format, ou si on est dans une transition).
  let userId = (session.user as any).id as string | undefined
  if (!userId && session.user?.email) {
    const { data: u } = await sb.from('users').select('id').ilike('email', session.user.email).maybeSingle()
    userId = u?.id
  }
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 401 })
  const { data: links } = await sb
    .from('user_auth_providers')
    .select('id, provider, provider_email, linked_at')
    .eq('user_id', userId)
    .order('linked_at', { ascending: true })

  // Compte aussi si l user a un password_hash (qui peut etre absent meme si credentials est dans la liste)
  const { data: u } = await sb
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .maybeSingle()
  const hasPassword = !!u?.password_hash

  const providers = ALL_PROVIDERS.map((p: ProviderKey) => {
    const link = (links || []).find((l: any) => l.provider === p)
    if (p === 'credentials') {
      // Le lien credentials est lie au password_hash effectif.
      // Sans password_hash → la methode n est pas active meme si row presente
      return {
        provider:      p,
        linked:        !!link && hasPassword,
        link_id:       link?.id || null,
        provider_email: link?.provider_email || null,
        linked_at:     link?.linked_at || null,
      }
    }
    return {
      provider:      p,
      linked:        !!link,
      link_id:       link?.id || null,
      provider_email: link?.provider_email || null,
      linked_at:     link?.linked_at || null,
    }
  })

  return NextResponse.json({
    providers,
    total_linked: providers.filter(p => p.linked).length,
  })
}

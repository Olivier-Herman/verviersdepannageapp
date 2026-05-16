// src/app/api/profile/auth-providers/start-link/route.ts
//
// POST { provider } : prepare le linking d un OAuth provider au user courant.
// Pose un cookie HttpOnly `linking_user_id` (5 min de TTL) signe avec le secret
// NextAuth. Le signIn callback (lib/auth.ts) detecte ce cookie et au lieu de
// creer/auth, il ajoute juste un lien dans user_auth_providers.
//
// Retourne { redirect_to } - le client fait window.location.href = redirect_to
// pour lancer le flow OAuth standard NextAuth.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { cookies }           from 'next/headers'

const LINKING_COOKIE = 'vd_linking_user_id'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 401 })

  const body = await req.json() as { provider?: string }
  const provider = body.provider
  if (!provider || !['apple', 'google', 'azure-ad'].includes(provider)) {
    return NextResponse.json({ error: 'Provider invalide' }, { status: 400 })
  }

  // Cookie HttpOnly, 5 min, secure en prod
  cookies().set(LINKING_COOKIE, userId, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   5 * 60,
  })

  // URL OAuth NextAuth standard. callbackUrl = /profil?linked=<provider>
  const callbackUrl = `/profil?linked=${provider}`
  return NextResponse.json({
    redirect_to: `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent(callbackUrl)}`,
  })
}

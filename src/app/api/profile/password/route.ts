// src/app/api/profile/password/route.ts
//
// POST { current_password?, new_password } :
// - Si l user a deja un password_hash, current_password est requis pour confirmer.
// - Si pas de password_hash, current_password ignore (set initial).
// Hash bcrypt + update users.password_hash + upsert user_auth_providers (credentials).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt                from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 401 })

  const body = await req.json() as { current_password?: string; new_password?: string }
  const newPassword = (body.new_password || '').trim()
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Le mot de passe doit faire au moins 8 caractères' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: u } = await sb
    .from('users')
    .select('id, email, password_hash')
    .eq('id', userId)
    .maybeSingle()
  if (!u) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  // Si deja un password : current_password requis pour confirmer
  if (u.password_hash) {
    const current = (body.current_password || '').trim()
    if (!current) return NextResponse.json({ error: 'Mot de passe actuel requis' }, { status: 400 })
    const ok = await bcrypt.compare(current, u.password_hash)
    if (!ok) return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 400 })
  }

  const hash = await bcrypt.hash(newPassword, 12)
  await sb.from('users').update({ password_hash: hash }).eq('id', userId)

  // Persiste le lien credentials (idempotent)
  const emailLower = (u.email || '').toLowerCase()
  await sb.from('user_auth_providers').upsert(
    {
      user_id:             userId,
      provider:            'credentials',
      provider_account_id: emailLower,
      provider_email:      emailLower,
    },
    { onConflict: 'provider,provider_account_id' }
  )

  return NextResponse.json({ ok: true })
}

// DELETE : retire le mot de passe (= dissocie la methode credentials)
export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'No user id' }, { status: 401 })

  const sb = createAdminClient()
  // Verifier qu il reste une autre methode
  const { data: links } = await sb.from('user_auth_providers')
    .select('provider').eq('user_id', userId)
  const others = (links || []).filter(l => l.provider !== 'credentials')
  if (others.length === 0) {
    return NextResponse.json({ error: 'Impossible de retirer le mot de passe : c\'est la dernière méthode de connexion' }, { status: 400 })
  }

  await sb.from('users').update({ password_hash: null }).eq('id', userId)
  await sb.from('user_auth_providers')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'credentials')

  return NextResponse.json({ ok: true })
}

// POST /api/garage/set-initial-password { newPassword } — premier acces user
// garage : pas besoin de l ancien mdp si must_change_password=true.
// Olivier 2026-06-02.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt                from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role: string = (session.user as any).role || ''
  if (role !== 'garage') {
    return NextResponse.json({ error: 'Route reservee aux comptes garage' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const newPassword = String(body?.newPassword || '')
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Mot de passe trop court (min 8 caracteres)' }, { status: 400 })
  }

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const sb = createAdminClient()
  // Verif must_change_password (ne permet pas de set initial sans raison legitime)
  const { data: u } = await sb.from('users')
    .select('id, role, must_change_password')
    .eq('id', userId)
    .maybeSingle()
  if (!u || u.role !== 'garage') {
    return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 })
  }
  if (!u.must_change_password) {
    return NextResponse.json({ error: 'Mot de passe deja defini. Utilise /api/auth/change-password pour le modifier.' }, { status: 400 })
  }

  const hash = await bcrypt.hash(newPassword, 10)
  const { error } = await sb.from('users')
    .update({ password_hash: hash, must_change_password: false })
    .eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

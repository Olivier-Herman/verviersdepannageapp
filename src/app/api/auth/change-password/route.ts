import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { currentPassword, newPassword } = await req.json()
  if (!currentPassword || !newPassword) return NextResponse.json({ error: 'Données manquantes' }, { status: 400 })
  if (newPassword.length < 8) return NextResponse.json({ error: 'Mot de passe trop court (min. 8 caractères)' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: user } = await supabase.from('users').select('id, password_hash').eq('id', (session.user as any).id).single()
  if (!user?.password_hash) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 403 })

  const hash = await bcrypt.hash(newPassword, 10)
  await supabase.from('users').update({ password_hash: hash, must_change_password: false }).eq('id', user.id)

  return NextResponse.json({ success: true })
}

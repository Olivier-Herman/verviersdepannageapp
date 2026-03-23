import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendPasswordReset } from '@/lib/emails'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email requis' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: user } = await supabase.from('users')
    .select('id, name, email, auth_provider')
    .ilike('email', email).maybeSingle()

  if (!user) return NextResponse.json({ success: true })

  // Compte Google → pas de reset possible
  if (user.auth_provider === 'google') {
    return NextResponse.json({ error: 'GOOGLE_PROVIDER' }, { status: 400 })
  }

  // Compte Microsoft → pas de reset possible
  if (user.auth_provider === 'microsoft') {
    return NextResponse.json({ error: 'MICROSOFT_PROVIDER' }, { status: 400 })
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 3600 * 1000)

  await supabase.from('users').update({
    reset_token: token,
    reset_token_expires_at: expires.toISOString()
  }).eq('id', user.id)

  const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`

  try {
    await sendPasswordReset({ toEmail: user.email, name: user.name, resetUrl })
  } catch (err: any) {
    console.error('[Reset] Email error:', err.message)
  }

  return NextResponse.json({ success: true })
}

export async function PUT(req: NextRequest) {
  const { token, newPassword } = await req.json()
  if (!token || !newPassword) return NextResponse.json({ error: 'Données manquantes' }, { status: 400 })
  if (newPassword.length < 8) return NextResponse.json({ error: 'Mot de passe trop court' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: user } = await supabase.from('users')
    .select('id').eq('reset_token', token)
    .gt('reset_token_expires_at', new Date().toISOString())
    .maybeSingle()

  if (!user) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 400 })

  const hash = await bcrypt.hash(newPassword, 10)
  await supabase.from('users').update({
    password_hash: hash, must_change_password: false,
    reset_token: null, reset_token_expires_at: null,
  }).eq('id', user.id)

  return NextResponse.json({ success: true })
}

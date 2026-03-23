import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendAccessRequestNotification } from '@/lib/emails'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const { email, name } = await req.json()
  if (!email || !name) return NextResponse.json({ error: 'Email et nom requis' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: existing } = await supabase.from('users')
    .select('id, active').ilike('email', email).maybeSingle()

  if (existing) {
    if (existing.active) return NextResponse.json({ error: 'Un compte existe déjà avec cet email' }, { status: 409 })
    await sendAccessRequestNotification({ name, email, provider: 'email_password' })
    return NextResponse.json({ success: true })
  }

  const hash = await bcrypt.hash('!Verviers4800', 10)
  const { error } = await supabase.from('users').insert({
    email: email.toLowerCase(), name,
    role: 'driver', active: false,
    auth_provider: 'email_password',
    password_hash: hash,
    must_change_password: true,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sendAccessRequestNotification({ name, email, provider: 'email_password' })
  return NextResponse.json({ success: true })
}

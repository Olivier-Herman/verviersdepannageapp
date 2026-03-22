import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { pin } = await req.json()
  if (!pin || !/^\d{4}$/.test(pin.toString())) {
    return NextResponse.json({ error: 'Le PIN doit être exactement 4 chiffres' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const hash = await bcrypt.hash(pin.toString(), 10)
  const { error } = await supabase.from('users')
    .update({ verify_pin_hash: hash }).eq('email', session.user.email)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['admin', 'superadmin'].includes((session.user as any).role)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

  const supabase = createAdminClient()
  const hash = await bcrypt.hash('!Verviers4800', 10)

  const { error } = await supabase.from('users').update({
    password_hash: hash,
    must_change_password: true,
  }).eq('id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendAccountActivated } from '@/lib/emails'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: user, error } = await supabase
    .from('users')
    .select('email, name, auth_provider')
    .eq('id', userId)
    .single()

  if (error || !user) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  try {
    await sendAccountActivated({
      toEmail:      user.email,
      name:         user.name || user.email,
      authProvider: user.auth_provider || 'email_password',
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

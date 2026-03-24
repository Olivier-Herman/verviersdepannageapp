// src/app/api/push/test/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { sendPushToUser }            from '@/lib/push'
import { createAdminClient }         from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const body     = await req.json().catch(() => ({}))

  let targetUserId: string | null = null

  // Accès direct avec userId (pour tests curl — clé secrète requise)
  if (body.userId && body.secret === process.env.CRON_SECRET) {
    targetUserId = body.userId
  } else {
    // Accès authentifié normal
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const { data: me } = await supabase
      .from('users').select('id').eq('email', session.user.email!).single()
    if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    targetUserId = me.id
  }

  const result = await sendPushToUser(targetUserId, {
    title: '🔔 Test — Verviers Dépannage',
    body:  'Les notifications push fonctionnent correctement !',
    url:   '/dashboard',
    tag:   'test',
  })

  return NextResponse.json(result)
}

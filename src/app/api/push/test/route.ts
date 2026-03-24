// src/app/api/push/test/route.ts
// Route de test — admin uniquement
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { sendPushToUser }            from '@/lib/push'
import { createAdminClient }         from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const isAdmin = ['admin', 'superadmin'].includes((session.user as any).role)
  if (!isAdmin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const supabase = createAdminClient()
  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const result = await sendPushToUser(me.id, {
    title: '🔔 Test notification',
    body:  'Les notifications push fonctionnent correctement !',
    url:   '/dashboard',
    tag:   'test',
  })

  return NextResponse.json(result)
}

// src/app/api/push/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

// POST : enregistrer un abonnement push
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const body     = await req.json()
  const { endpoint, keys, userAgent } = body

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Abonnement invalide' }, { status: 400 })
  }

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id:    me.id,
      endpoint,
      p256dh:     keys.p256dh,
      auth:       keys.auth,
      user_agent: userAgent ?? null,
    }, { onConflict: 'user_id,endpoint' })

  if (error) {
    console.error('[Push subscribe]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE : supprimer un abonnement push
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { endpoint } = await req.json()

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', me.id)
    .eq('endpoint', endpoint)

  return NextResponse.json({ success: true })
}

// GET : vérifier si l'utilisateur a un abonnement actif
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ subscribed: false })

  const { data } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, created_at')
    .eq('user_id', me.id)

  return NextResponse.json({ subscribed: (data?.length ?? 0) > 0, count: data?.length ?? 0 })
}

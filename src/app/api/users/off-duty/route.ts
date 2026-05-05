// src/app/api/users/off-duty/route.ts
//
// Marque l'utilisateur comme "hors service" : efface la derniere position
// pour qu'il disparaisse du modal "Choisir un chauffeur".

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: user } = await sb
    .from('users').select('id').eq('email', session.user!.email!).single()
  if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  await sb.from('users').update({
    last_location_lat:   null,
    last_location_lng:   null,
    location_updated_at: null,
  }).eq('id', user.id)

  return NextResponse.json({ ok: true })
}

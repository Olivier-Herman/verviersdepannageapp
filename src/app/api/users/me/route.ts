// src/app/api/users/me/route.ts
//
// Renvoie les infos du user courant utiles cote client : ici principalement
// le planning (schedule_day / schedule_night) pour determiner si le user est
// force en service par son horaire.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: user, error } = await sb
    .from('users')
    .select('id, name, role, schedule_day, schedule_night, towsoft_name')
    .eq('email', session.user!.email!)
    .single()
  if (error || !user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  return NextResponse.json(user)
}

// src/app/api/users/active-assignment-count/route.ts
//
// Renvoie le nombre de missions ATTRIBUÉES au chauffeur courant encore actives.
// Sert à piloter le GPS : on ne l'active QUE tant qu'il y a ≥1 attribution
// (dès 'assigned', avant même l'acceptation), et on le coupe à 0 → économie
// batterie majeure (plus de GPS toute la vacation). Olivier 2026-07-26.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GPS actif dès l'attribution (assigned) jusqu'à la fin de prise en charge.
const ACTIVE = ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress', 'delivering']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ count: 0 }, { status: 200 })

  const sb = createAdminClient()
  const { data: user } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()
  if (!user) return NextResponse.json({ count: 0 })

  const { count } = await sb
    .from('incoming_missions')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', user.id)
    .in('status', ACTIVE)

  return NextResponse.json({ count: count || 0 })
}

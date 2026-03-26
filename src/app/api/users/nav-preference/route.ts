// src/app/api/users/nav-preference/route.ts
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { nav_app } = await req.json()
  if (!['gmaps', 'waze', 'apple'].includes(nav_app)) {
    return NextResponse.json({ error: 'App invalide' }, { status: 400 })
  }

  const supabase = createAdminClient()
  await supabase.from('users')
    .update({ nav_app })
    .eq('email', session.user.email!)

  return NextResponse.json({ ok: true, nav_app })
}

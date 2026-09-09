// src/app/api/users/nav-preference/route.ts
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const supabase = createAdminClient()

  // Favoris du menu (lot 1 du menu v3, 09/09/2026) : liste de chemins, par utilisateur.
  if (Array.isArray(body.nav_favorites)) {
    const favs = body.nav_favorites
      .map((h: any) => String(h || '').trim())
      .filter((h: string) => h.startsWith('/') && h.length <= 120)
      .filter((h: string, i: number, a: string[]) => a.indexOf(h) === i)
      .slice(0, 12)
    await supabase.from('users').update({ nav_favorites: favs }).eq('email', session.user.email!)
    return NextResponse.json({ ok: true, nav_favorites: favs })
  }

  const { nav_app } = body
  if (!['gmaps', 'waze', 'apple'].includes(nav_app)) {
    return NextResponse.json({ error: 'App invalide' }, { status: 400 })
  }
  await supabase.from('users')
    .update({ nav_app })
    .eq('email', session.user.email!)

  return NextResponse.json({ ok: true, nav_app })
}

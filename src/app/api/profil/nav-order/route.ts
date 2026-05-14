// src/app/api/profil/nav-order/route.ts
//
// PATCH /api/profil/nav-order
// Body : { order: string[] | null }
//   order: liste des hrefs dans l'ordre voulu, ou null pour reset au default
//
// Permet a chaque user de personnaliser l'ordre du menu sidebar via drag&drop
// dans /profil. Pas de check d'admin : un user peut toujours modifier SON
// propre ordre.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id as string | undefined
  if (!userId) return NextResponse.json({ error: 'userId manquant' }, { status: 400 })

  const body = await req.json() as { order?: unknown }
  let order: string[] | null = null
  if (body.order === null) {
    order = null
  } else if (Array.isArray(body.order)) {
    // Sanity : que des strings, max 50 entrees, deduplique
    const cleaned = (body.order as unknown[])
      .filter((x): x is string => typeof x === 'string' && x.startsWith('/'))
      .slice(0, 50)
    order = Array.from(new Set(cleaned))
  } else {
    return NextResponse.json({ error: 'order doit etre un array de hrefs ou null' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { error } = await sb
    .from('users')
    .update({ nav_order: order })
    .eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, order })
}

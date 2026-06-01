// POST /api/users/me/language : change la langue d affichage du user connecte.
// Body : { language: 'fr' | 'sq' }
// Olivier 2026-06-01 (i18n).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['fr', 'sq'])

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  let language: string
  try {
    const body = await req.json()
    language = body?.language
  } catch {
    return NextResponse.json({ error: 'Body invalide' }, { status: 400 })
  }

  if (!ALLOWED.has(language)) {
    return NextResponse.json({
      error: `Langue inconnue: ${language}`,
      allowed: [...ALLOWED],
    }, { status: 400 })
  }

  const sb = createAdminClient()
  const { error } = await sb.from('users').update({ language }).eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, language })
}

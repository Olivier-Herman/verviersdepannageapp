// GET /api/evaluation/list
// Retourne toutes les evaluations de l user connecte (utilise par la page
// /evaluation pour pre-remplir les forms avec ce qui a deja ete saisi).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('evaluations')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ evaluations: data || [] })
}

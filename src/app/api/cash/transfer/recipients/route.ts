// GET /api/cash/transfer/recipients
// Liste des receveurs possibles pour un transfert : tous les users actifs sauf le user courant.

export const dynamic = 'force-dynamic'

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: me } = await supabase
    .from('users').select('id').eq('email', session.user.email).single()
  if (!me?.id) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const { data: users } = await supabase
    .from('users')
    .select('id, name')
    .eq('active', true)
    .neq('id', me.id)
    .order('name', { ascending: true })

  return NextResponse.json({ recipients: users || [] })
}

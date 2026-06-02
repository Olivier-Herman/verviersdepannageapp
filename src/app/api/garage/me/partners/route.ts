// GET  /api/garage/me/partners : liste des entites du user garage connecte,
//                                avec celle qui est actuellement selectionnee
// POST /api/garage/me/partners { partner_id } : switch d entite
// Olivier 2026-06-02.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'garage') return NextResponse.json({ error: 'Reserve garage' }, { status: 403 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('garage_user_partners')
    .select(`
      garage_partner_id, is_default, last_selected_at,
      garage_partners ( id, name, active )
    `)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const partners = (data || [])
    .filter(gup => (gup as any).garage_partners?.active)
    .map(gup => ({
      id:               (gup as any).garage_partners.id,
      name:             (gup as any).garage_partners.name,
      is_default:       gup.is_default,
      last_selected_at: gup.last_selected_at,
    }))
    .sort((a, b) => {
      // Tri : last_selected_at desc puis is_default desc puis name
      if (a.last_selected_at && b.last_selected_at) return b.last_selected_at!.localeCompare(a.last_selected_at!)
      if (a.last_selected_at) return -1
      if (b.last_selected_at) return 1
      if (a.is_default && !b.is_default) return -1
      if (b.is_default && !a.is_default) return 1
      return a.name.localeCompare(b.name)
    })

  // current = premier de la liste (= last_selected ou default)
  const current = partners[0] || null

  return NextResponse.json({ partners, current })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'garage') return NextResponse.json({ error: 'Reserve garage' }, { status: 403 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const body       = await req.json().catch(() => ({}))
  const partnerId  = String(body?.partner_id || '')
  if (!partnerId) return NextResponse.json({ error: 'partner_id requis' }, { status: 400 })

  const sb = createAdminClient()
  // Verif que ce partner est bien lie a ce user
  const { data: link } = await sb
    .from('garage_user_partners')
    .select('user_id')
    .eq('user_id', userId)
    .eq('garage_partner_id', partnerId)
    .maybeSingle()
  if (!link) return NextResponse.json({ error: 'Acces refuse a cette entite' }, { status: 403 })

  // Update last_selected_at
  const { error } = await sb.from('garage_user_partners')
    .update({ last_selected_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('garage_partner_id', partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

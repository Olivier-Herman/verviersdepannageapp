// Matrice des compétences réception (motifs × employés). SUPERADMIN uniquement.
// GET  → { users, motifs, links }
// POST { user_id, motif_id, on } → active/désactive la compétence.
// Olivier 2026-07-31.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

function isSuperadmin(session: any): boolean {
  const u = session?.user
  return u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })

  const sb = createAdminClient()
  const [{ data: usersRaw }, { data: motifs }, { data: links }] = await Promise.all([
    sb.from('users').select('id, name, role, roles, active').order('name'),
    sb.from('reception_motifs').select('id, label, kind, service').eq('active', true)
      .order('sort_order').order('label'),
    sb.from('user_competences').select('user_id, motif_id'),
  ])
  const STAFF = ['dispatcher', 'admin', 'superadmin']
  const users = (usersRaw || []).filter((u: any) =>
    u.active !== false &&
    (u.roles && u.roles.length ? u.roles : [u.role]).filter(Boolean).some((r: string) => STAFF.includes(r)))
  return NextResponse.json({ users, motifs: motifs || [], links: links || [] })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })

  const body     = await req.json().catch(() => ({}))
  const userId   = String(body.user_id || '')
  const motifId  = String(body.motif_id || '')
  const on       = !!body.on
  if (!userId || !motifId) return NextResponse.json({ error: 'user_id / motif_id requis' }, { status: 400 })

  const sb = createAdminClient()
  if (on) {
    const { error } = await sb.from('user_competences')
      .upsert({ user_id: userId, motif_id: motifId, created_by: (session.user as any).id || null },
              { onConflict: 'user_id,motif_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from('user_competences').delete().eq('user_id', userId).eq('motif_id', motifId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, on })
}

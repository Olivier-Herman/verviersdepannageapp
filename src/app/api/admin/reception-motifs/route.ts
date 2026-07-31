// CRUD admin des MOTIFS de réception (visite/appel) — catalogue paramétrable.
// Chaque motif = une compétence activable (matrice user_competences).
// Réservé admin/superadmin. Olivier 2026-07-31.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

function requireAdmin(session: any): boolean {
  return ['admin', 'superadmin'].includes(session?.user?.role || '')
}

const KINDS = ['visit', 'call', 'both']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb.from('reception_motifs').select('*')
    .order('sort_order', { ascending: true }).order('label', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motifs: data })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const body  = await req.json().catch(() => ({}))
  const label = (body.label || '').trim()
  if (!label) return NextResponse.json({ error: 'Libellé requis' }, { status: 400 })
  const kind = KINDS.includes(body.kind) ? body.kind : 'visit'

  const sb = createAdminClient()
  const { data, error } = await sb.from('reception_motifs').insert({
    label, kind,
    label_en:         (body.label_en || '').trim() || null,
    service:          (body.service || '').trim() || null,
    requires_vehicle: !!body.requires_vehicle,
    free_text:        !!body.free_text,
    sort_order:       body.sort_order != null ? Number(body.sort_order) : 100,
    active:           body.active !== false,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motif: data })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = {}
  if (body.label            !== undefined) patch.label            = String(body.label).trim()
  if (body.label_en         !== undefined) patch.label_en         = (body.label_en || '').trim() || null
  if (body.kind             !== undefined) patch.kind             = KINDS.includes(body.kind) ? body.kind : 'visit'
  if (body.service          !== undefined) patch.service          = (body.service || '').trim() || null
  if (body.requires_vehicle !== undefined) patch.requires_vehicle = !!body.requires_vehicle
  if (body.free_text        !== undefined) patch.free_text        = !!body.free_text
  if (body.sort_order       !== undefined) patch.sort_order       = Number(body.sort_order) || 100
  if (body.active           !== undefined) patch.active           = !!body.active
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Aucun champ' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb.from('reception_motifs').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motif: data })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  // Soft delete (active=false) : préserve l'historique des interactions.
  const sb = createAdminClient()
  const { data, error } = await sb.from('reception_motifs').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motif: data })
}

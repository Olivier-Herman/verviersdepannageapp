// src/app/api/inventaire/sessions/[id]/items/route.ts
//
// POST /api/inventaire/sessions/[id]/items
// Ajoute un item a la session (1 par scan).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  // Verifie que la session appartient bien au user
  const { data: sess } = await sb
    .from('inventaire_sessions')
    .select('id, user_id, completed_at')
    .eq('id', params.id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (sess.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as any

  const { data, error } = await sb.from('inventaire_session_items').insert({
    session_id:    params.id,
    status:        body.status || 'ok',
    item_type:     body.type || body.item_type || null,
    label:         body.label || null,
    sublabel:      body.sublabel || null,
    msg:           body.msg || null,
    zone:          body.zone || null,
    printed:       typeof body.printed === 'boolean' ? body.printed : null,
    ticket_id:     body.ticketId ?? body.ticket_id ?? null,
    mission_num:   body.missionNum || body.mission_num || null,
    ref_dossier:   body.refDossier || body.ref_dossier || null,
    date_mission:  body.dateMission || body.date_mission || null,
    marque:        body.marque || null,
    modele:        body.modele || null,
    plaque:        body.plaque || null,
    vin:           body.vin || null,
    motif:         body.motif || null,
    parc:          body.parc || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Touch session updated_at pour qu elle remonte dans la query "active la plus recente"
  await sb.from('inventaire_sessions').update({ updated_at: new Date().toISOString() }).eq('id', params.id)

  return NextResponse.json({ ok: true, item: data })
}

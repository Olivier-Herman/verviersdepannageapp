// src/app/api/missions/[id]/toggle-police-blocked/route.ts
//
// POST /api/missions/[id]/toggle-police-blocked
// Body: { blocked: boolean, reason?: string }
//
// Olivier 2026-06-04 : toggle police_blocked sur la fiche dispatch en tant
// qu operateur fourriere. Cas typique : pour les mal_garees, la police
// demande parfois le blocage APRES coup (apres remorquage) - le chauffeur
// n est pas au courant donc on ajoute la coche cote fourriere.
//
// Reservee module fourriere (et admin/superadmin).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface Body {
  blocked: boolean
  reason?: string
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!modules.includes('fourriere') && !['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden : module fourriere requis' }, { status: 403 })
  }

  const body = await req.json() as Body
  if (typeof body.blocked !== 'boolean') {
    return NextResponse.json({ error: 'blocked (boolean) requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Charge mission pour vérifier source + ancien etat
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, source, police_blocked')
    .eq('id', params.id)
    .single()
  if (mErr || !mission) {
    return NextResponse.json({ error: `Mission introuvable : ${mErr?.message}` }, { status: 404 })
  }

  if (mission.police_blocked === body.blocked) {
    return NextResponse.json({ error: `Deja ${body.blocked ? 'bloquee' : 'non-bloquee'}` }, { status: 400 })
  }

  // Update
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({
      police_blocked: body.blocked,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', params.id)
  if (upErr) {
    return NextResponse.json({ error: `Update KO : ${upErr.message}` }, { status: 500 })
  }

  // Log
  const action = body.blocked ? 'police_block_added' : 'police_block_removed'
  const noteParts = [
    body.blocked ? 'Blocage police ajouté' : 'Blocage police retiré',
    `par ${user.name || user.email || 'operateur fourriere'}`,
  ]
  if (body.reason) noteParts.push(`Raison : ${body.reason}`)
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    action,
    notes:      noteParts.join(' · '),
    actor_id:   user.id,
    metadata:   {
      from: !body.blocked,
      to:   body.blocked,
      reason: body.reason || null,
    },
  }).then(() => {}, e => console.warn(`[toggle-police-blocked] log KO mission=${params.id}:`, e?.message))

  return NextResponse.json({
    ok: true,
    blocked: body.blocked,
    message: body.blocked ? '✓ Blocage police ajouté' : '✓ Blocage police retiré',
  })
}

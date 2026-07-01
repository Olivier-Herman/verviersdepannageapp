// src/app/api/requisitoires/[id]/attach/route.ts
//
// POST /api/requisitoires/[id]/attach   body: { mission_id }
//   Rattache un réquisitoire capturé à une fiche choisie (annexion + concat PV).
//   Accès : admin / superadmin / module fourriere.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { attachRequisitoire } from '@/lib/requisitoire/attach'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = user?.modules || []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  let missionId = String(body?.mission_id || '').trim()
  const missionNumber = String(body?.mission_number || '').trim()

  const sb = createAdminClient()

  // Rattachement manuel par n° de fiche : on résout l'id.
  if (!missionId && missionNumber) {
    const { data: m } = await sb.from('incoming_missions')
      .select('id').eq('mission_number', missionNumber).maybeSingle()
    if (!m) return NextResponse.json({ error: `Aucune fiche n° ${missionNumber}` }, { status: 404 })
    missionId = m.id
  }
  if (!missionId) return NextResponse.json({ error: 'mission_id ou mission_number requis' }, { status: 400 })

  const { data: actor } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()

  const leveeType = body?.levee_type === 'temporaire' ? 'temporaire' : body?.levee_type === 'definitive' ? 'definitive' : undefined
  const res = await attachRequisitoire(sb, params.id, missionId, actor?.id ?? null, {
    leveeDate: body?.levee_date ? String(body.levee_date) : undefined,
    leveeType,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, mail_moved: res.mailMoved, date_adapted: res.dateAdapted })
}

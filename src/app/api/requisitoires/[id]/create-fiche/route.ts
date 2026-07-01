// src/app/api/requisitoires/[id]/create-fiche/route.ts
//
// POST /api/requisitoires/[id]/create-fiche
//   Crée une fiche (police_saisie, parc J) préremplie depuis le réquisitoire et
//   y annexe le document. Pour le cas « aucune fiche existante ne correspond ».
//   Accès : admin / superadmin / module fourriere.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { createFicheFromIntake } from '@/lib/requisitoire/create-fiche'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = user?.modules || []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()

  const res = await createFicheFromIntake(sb, params.id, actor?.id ?? null)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, mission_id: res.mission_id, mission_number: res.mission_number, mail_moved: res.mailMoved })
}

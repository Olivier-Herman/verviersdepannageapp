// src/app/api/requisitoires/[id]/ignore/route.ts
//
// POST /api/requisitoires/[id]/ignore
//   Écarte un réquisitoire de la file (faux positif / à traiter autrement).
//   Accès : admin / superadmin / module fourriere.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

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
  const { error } = await sb.from('requisitoire_intake')
    .update({ status: 'ignored' }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

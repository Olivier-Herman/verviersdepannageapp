// src/app/api/requisitoires/move-attached/route.ts
//
// POST /api/requisitoires/move-attached
//   Rattrapage : déplace vers « Mail auto-géré » les mails des documents DÉJÀ
//   rattachés dont le mail n'a pas encore été déplacé (ex. rattachés avant que
//   le déplacement fonctionne). Nettoie la boîte d'un coup.
//   Accès : admin / superadmin / module fourriere.
//
// Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { moveMessageToFolder, AUTO_MANAGED_FOLDER } from '@/lib/requisitoire/graph'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MAX_PER_RUN = 60

export async function POST() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: rows, error } = await sb
    .from('requisitoire_intake')
    .select('id, mailbox, source_email_id')
    .eq('status', 'attached')
    .like('mailbox', '%@%')            // uniquement les vrais mails (pas les imports manuels)
    .not('source_email_id', 'is', null)
    .order('attached_at', { ascending: false })
    .limit(MAX_PER_RUN)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let moved = 0, failed = 0, notFound = 0
  const errors: string[] = []
  for (const r of rows || []) {
    const mv = await moveMessageToFolder(r.mailbox, r.source_email_id, AUTO_MANAGED_FOLDER)
    if (mv.ok) moved++
    else if ((mv.error || '').includes('404') || (mv.error || '').toLowerCase().includes('notfound') || (mv.error || '').includes('ErrorItemNotFound')) notFound++
    else { failed++; if (errors.length < 3) errors.push(mv.error || 'échec') }
  }

  return NextResponse.json({
    ok: true, total: (rows || []).length, moved, already_or_gone: notFound, failed, errors,
  })
}

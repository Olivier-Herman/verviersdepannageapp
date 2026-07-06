// src/app/api/requisitoires/run/route.ts
//
// POST /api/requisitoires/run
//   Déclenche manuellement la capture des réquisitoires (bouton « Traiter les
//   mails existants » / « Import »). Utile pour tester sur les mails déjà
//   présents dans fourriere@, et pour forcer un import à réception d'un appel.
//   Accès : admin / superadmin / module fourriere.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { pollRequisitoires, rematchPendingRequisitoires } from '@/lib/requisitoire/intake'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = user?.modules || []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let top = 25
  try { const body = await req.json(); if (body?.top) top = Math.min(50, Number(body.top)) } catch {}

  try {
    const summary = await pollRequisitoires({ top })
    // Re-score aussi les réquisitoires déjà en attente avec la logique courante
    // (ex : nouveau ciblage adresse) → les anciens non résolus profitent des
    // améliorations sans re-extraction.
    const rematch = await rematchPendingRequisitoires()
    return NextResponse.json({ ok: true, ...summary, rematch })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}

// src/app/api/cron/poll-requisitoires/route.ts
//
// Cron : capture périodique des réquisitoires reçus dans fourriere@.
// Protégé par CRON_SECRET (comme poll-missions). Best-effort.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { NextResponse }      from 'next/server'
import { pollRequisitoires } from '@/lib/requisitoire/intake'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const summary = await pollRequisitoires({ top: 25 })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    console.error('[cron poll-requisitoires] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}

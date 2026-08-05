// src/app/api/cron/touring-check-refresh/route.ts
//
// Rafraîchit la liste « Check Touring » automatiquement (reconstruction + persist)
// pour que la vue Touring reste à jour SANS que le superadmin clique « Rafraîchir ».
// N'exécute PAS le rapprochement accord (lourd — il reste hebdo mercredi 8h + le 5).
// persistCheckList pousse aussi le signal realtime → les vues ouvertes se rechargent.
// Auth : Bearer CRON_SECRET.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { buildTouringCheckList } from '@/lib/touring/check-list'
import { persistCheckList } from '@/lib/touring/check-persist'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  try {
    const items = await buildTouringCheckList(sb)
    await persistCheckList(sb, items)
    return NextResponse.json({ ok: true, count: items.length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'échec' }, { status: 502 })
  }
}

// src/app/api/cron/refresh-fines-odoo/route.ts
//
// Cron quotidien : rafraîchit le n° + statut Odoo des amendes facturées
// (brouillon → comptabilisée → payée). Protégé par CRON_SECRET.
// Planifié ~8h heure locale Belgique (voir vercel.json). Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { refreshManyFinesOdoo } from '@/lib/fines/odoo-bill'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const res = await refreshManyFinesOdoo(createAdminClient())
    return NextResponse.json({ ok: true, ...res })
  } catch (err: any) {
    console.error('[cron refresh-fines-odoo] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}

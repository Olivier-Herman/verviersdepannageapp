// src/app/api/cron/controle-parc/route.ts — contrôle aléatoire du parc (Olivier 17/11/2026) : toutes les 5 min les
// mardis, jeudis et samedis ; tire l'heure du jour puis, à l'heure venue, envoie la fenêtre au bureau. ?force=1 pour un essai.
export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tickControleParc } from '@/lib/parc/controle-aleatoire'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const force = new URL(req.url).searchParams.get('force') === '1'
    return NextResponse.json({ ok: true, ...(await tickControleParc(createAdminClient(), { force })) })
  } catch (e: any) {
    console.error('[cron controle-parc]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

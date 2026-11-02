// Cron (chaque nuit, 3 h) — journal des tâches de Mobi : compte la veille (Mobi lui-même / automatismes) et purge
// au-delà de 12 mois (Olivier 02/11/2026). Pas branché sur « Mes assistants » : c'est un relevé, pas une action.
// Un cron en échec doit se voir : erreur → réponse 500.
export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { agregerJour } from '@/lib/journal-mobi'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const url = new URL(req.url)
    const veille = url.searchParams.get('jour') || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(Date.now() - 86_400_000))
    const counts = await agregerJour(createAdminClient(), veille)
    return NextResponse.json({ ok: true, jour: veille, counts })
  } catch (e: any) {
    console.error('[journal-mobi]', e?.message || e)
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

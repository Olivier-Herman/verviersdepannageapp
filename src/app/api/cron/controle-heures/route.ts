// src/app/api/cron/controle-heures/route.ts — toutes les heures : heures des assistances décalées d'une heure ?
// (Olivier 25/10/2026). Protégé par CRON_SECRET.
import { NextResponse } from 'next/server'
import { controleHeures } from '@/lib/time/controle-heures'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ ok: true, ...(await controleHeures()) }) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 }) }
}

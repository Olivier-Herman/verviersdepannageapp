// src/app/api/cron/telegram-differes/route.ts — envoie à Mobi, dès le début de son créneau « Verviers Dépannage »,
// les notifications Telegram retenues hors de ses heures (Olivier 24/10/2026). Protégé par CRON_SECRET.
import { NextResponse } from 'next/server'
import { envoyerDifferes } from '@/lib/notif/heures-mobi'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ ok: true, envoyes: await envoyerDifferes() }) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 }) }
}

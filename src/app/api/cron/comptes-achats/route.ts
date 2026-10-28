// src/app/api/cron/comptes-achats/route.ts — compte de charge par fournisseur (Olivier 28/10/2026) : chaque matin,
// bon compte sur les brouillons d'achat, puis reclassement du mois en cours et du précédent pour les factures déjà
// validées. Règles : réglage achats_comptes_fournisseurs ; logique : lib/achats/comptes.ts. Un échec part sur Telegram.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { passageComptesAchats } from '@/lib/achats/comptes'
import { notifierTelegram } from '@/lib/notif/heures-mobi'
import { getBusinessNumber } from '@/lib/settings/business'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  { const { assistantEnPause, SKIP_PAUSE } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(createAdminClient(), 'comptes_achats')) return NextResponse.json(SKIP_PAUSE) }   // « Mes assistants » (Olivier 28/10/2026)
  const sb = createAdminClient()
  try {
    const res = await passageComptesAchats()
    await sb.from('app_settings').upsert({ key: 'comptes_achats_last_run', value: JSON.stringify({ at: new Date().toISOString(), ok: true, ...res }) }, { onConflict: 'key' }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, ...res })
  } catch (e: any) {
    const msg = String(e?.message || e)
    await sb.from('app_settings').upsert({ key: 'comptes_achats_last_run', value: JSON.stringify({ at: new Date().toISOString(), ok: false, erreur: msg }) }, { onConflict: 'key' }).then(() => {}, () => {})
    const chat = await getBusinessNumber('telegram_chat_mobi').catch(() => 0)
    if (chat) await notifierTelegram(chat, `⚠️ Comptes des achats : le passage du matin a échoué.\n${msg.slice(0, 500)}`).catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

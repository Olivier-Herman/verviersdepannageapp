// src/app/api/cron/rapprochement-avis/route.ts — lettrage automatique des avis de paiement (Olivier 28/10/2026) :
// après les lectures de 5 h et de midi. Bloc « Rapprochement des paiements » de « Mes assistants ».
// Résumé à Mobi sur Telegram quand quelque chose a été lettré ; les cas à trancher, le lundi seulement.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { rapprocherAvis } from '@/lib/finance/rapprochement-auto'
import { notifierTelegram } from '@/lib/notif/heures-mobi'
import { getBusinessNumber } from '@/lib/settings/business'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  { const { assistantEnPause, SKIP_PAUSE } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(sb, 'rapprochement')) return NextResponse.json(SKIP_PAUSE) }
  const r = await rapprocherAvis()
  await sb.from('app_settings').upsert({ key: 'rapprochement_avis_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...r }) }, { onConflict: 'key' }).then(() => {}, () => {})
  const lundi = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short' }) === 'Mon' && new Date().getUTCHours() < 11
  const lignes = [
    ...(r.lettres.length ? [`✅ Avis de paiement lettrés automatiquement :`, ...r.lettres.map(l => `• ${l}`)] : []),
    ...(r.erreurs.length ? [`⚠️ Échecs :`, ...r.erreurs.map(l => `• ${l}`)] : []),
    ...(lundi && r.aTrancher.length ? [`🔎 À trancher (rien n'a été touché) :`, ...r.aTrancher.map(l => `• ${l}`)] : []),
  ]
  if (lignes.length) { const chat = await getBusinessNumber('telegram_chat_mobi').catch(() => 0); if (chat) await notifierTelegram(chat, lignes.join('\n').slice(0, 3800)).catch(() => {}) }
  return NextResponse.json({ ok: !r.erreurs.length, ...r })
}

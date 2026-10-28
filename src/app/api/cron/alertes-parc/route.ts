// src/app/api/cron/alertes-parc/route.ts — alertes du parc (Olivier 28/10/2026, point 3 des optimisations ; né du scooter
// SAPJ268 resté en Transit sans contrôle et du réquisitoire 1XVR831 qui ne correspondait à aucun véhicule).
// Chaque matin de semaine : véhicules en zone Transit depuis plus de 48 h, et réquisitoires restés « à rattacher »
// depuis plus de 24 h. Notification au dispatch dans l'app, résumé à Mobi sur Telegram (dans ses heures).
// Bloc « Alertes du parc » de « Mes assistants ».
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const fr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  { const { assistantEnPause, SKIP_PAUSE } = await import('@/lib/facturation/suspension'); if (await assistantEnPause(sb, 'parc')) return NextResponse.json(SKIP_PAUSE) }
  const il48 = new Date(Date.now() - 48 * 3600e3).toISOString(), il24 = new Date(Date.now() - 24 * 3600e3).toISOString()

  const { data: transit } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, source, parked_at, created_at')
    .eq('parc_zone_key', 'Transit').eq('dossier_leg', false).in('status', ['parked', 'unlocated', 'awaiting_payment'])
  const vieux = (transit || []).filter(m => (m.parked_at || m.created_at) < il48)
    .sort((a, b) => String(a.parked_at || a.created_at).localeCompare(String(b.parked_at || b.created_at)))
  const { data: req0 } = await sb.from('requisitoire_intake').select('id, received_at, extracted').eq('status', 'pending').lt('received_at', il24).order('received_at')
  const reqs = (req0 || []).map(r => { const e = typeof r.extracted === 'string' ? JSON.parse(r.extracted) : (r.extracted || {}); return { ...r, e } })

  if (!vieux.length && !reqs.length) return NextResponse.json({ ok: true, transit: 0, requisitoires: 0 })

  const lignesT = vieux.map(m => `${m.vehicle_plate || '?'} (${m.vehicle_brand || m.source}) depuis le ${fr(m.parked_at || m.created_at)} — n° ${m.mission_number}`)
  const lignesR = reqs.map(r => `${r.e?.plaque || '?'} ${[r.e?.marque, r.e?.modele].filter(Boolean).join(' ')} — PV ${r.e?.pv_number || '?'}, reçu le ${fr(r.received_at)}`)
  const body = [
    vieux.length ? `${vieux.length} véhicule(s) en zone Transit depuis plus de 48 h : à placer ou à vérifier.` : '',
    reqs.length ? `${reqs.length} réquisitoire(s) sans véhicule correspondant : vérifier au parc ou demander la correction à la police.` : '',
  ].filter(Boolean).join(' ')
  try {
    const { sendNotificationToRoles } = await import('@/lib/notifications/send')
    await sendNotificationToRoles(['dispatcher', 'admin'], 'alertes_parc', { title: 'Parc : à vérifier', body, action_url: '/fourriere' } as any)
  } catch (e: any) { console.error('[alertes-parc] notification', e?.message) }
  try {
    const { notifierTelegram } = await import('@/lib/notif/heures-mobi')
    const { getBusinessNumber } = await import('@/lib/settings/business')
    const chat = await getBusinessNumber('telegram_chat_mobi')
    const texte = ['🅿️ Parc — à vérifier', ...(vieux.length ? ['', `Transit depuis plus de 48 h (${vieux.length}) :`, ...lignesT.map(l => `• ${l}`)] : []), ...(reqs.length ? ['', `Réquisitoires sans véhicule (${reqs.length}) :`, ...lignesR.map(l => `• ${l}`)] : [])].join('\n')
    await notifierTelegram(chat, texte.slice(0, 3800))
  } catch (e: any) { console.error('[alertes-parc] telegram', e?.message) }
  await sb.from('app_settings').upsert({ key: 'alertes_parc_last_run', value: JSON.stringify({ at: new Date().toISOString(), transit: lignesT, requisitoires: lignesR }) }, { onConflict: 'key' }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, transit: lignesT, requisitoires: lignesR })
}

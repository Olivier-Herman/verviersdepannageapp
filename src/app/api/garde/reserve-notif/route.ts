// src/app/api/garde/reserve-notif/route.ts
//
// Notif de nuit « missions libres dans Momo Market » de la RÉSERVE (garde de la
// semaine). Olivier 30/09/2026 : active par défaut, réactivée chaque soir à 18 h ;
// la réserve peut la couper pour la nuit courante ; le dispatcher de garde et les
// comptes du réglage « reserve_notif_copie » (Mobi) sont alors prévenus. Cf lib/missions/market-notify.ts (gardeNight, reserveNotifOn).
//
// GET  → { isReserve, enabled, nightKey }
// POST { enabled: boolean } → coupe / réactive pour la nuit courante

import { NextResponse }       from 'next/server'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { gardeNight, reserveNotifOn } from '@/lib/missions/market-notify'
import { sendNotificationToMany }     from '@/lib/notifications/send'
import { getBusinessList }            from '@/lib/settings/business'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const night = await gardeNight(sb)
  if (!night || night.reserve !== userId || night.nightFirst === userId) {
    return NextResponse.json({ isReserve: false })
  }
  const { data: u } = await sb.from('users').select('notif_preferences').eq('id', userId).maybeSingle()
  return NextResponse.json({ isReserve: true, enabled: reserveNotifOn(u?.notif_preferences, night.nightKey), nightKey: night.nightKey })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { enabled?: unknown }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled requis' }, { status: 400 })

  const sb = createAdminClient()
  const night = await gardeNight(sb)
  if (!night || night.reserve !== userId || night.nightFirst === userId) {
    return NextResponse.json({ error: 'Tu n’es pas de réserve cette nuit.' }, { status: 403 })
  }
  const { data: u } = await sb.from('users').select('name, notif_preferences').eq('id', userId).maybeSingle()
  const prefs = { ...((u?.notif_preferences || {}) as Record<string, unknown>) }
  const wasOn = reserveNotifOn(prefs, night.nightKey)
  if (body.enabled) delete prefs.market_reserve_off_night
  else prefs.market_reserve_off_night = night.nightKey

  const { error } = await sb.from('users').update({ notif_preferences: prefs }).eq('id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Changement réel → dispatcher de garde + comptes en copie (coupure = alerte, réactivation = info).
  if (wasOn !== body.enabled) {
    const who = u?.name || 'La réserve'
    const emails = await getBusinessList('reserve_notif_copie').catch(() => [] as string[])
    const [{ data: duty }, { data: copies }] = await Promise.all([
      sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle(),
      emails.length ? sb.from('users').select('id').eq('active', true).in('email', emails) : Promise.resolve({ data: [] as { id: string }[] }),
    ])
    const ids = [...new Set([duty?.user_id, ...(copies || []).map((c: any) => c.id)].filter(Boolean) as string[])].filter(id => id !== userId)
    if (ids.length) await sendNotificationToMany(ids, 'reserve_notif_toggled', body.enabled ? {
      title: `🌙 ${who} a réactivé sa notif de nuit`,
      body:  'La réserve sera de nouveau prévenue des missions libres quand le 1er départ est en mission.',
      action_url: '/dispatch',
    } : {
      title: `⚠️ ${who} a désactivé sa notif de nuit`,
      body:  'La réserve ne sera pas prévenue des missions libres cette nuit, même si le 1er départ est en mission. Elle se réactive toute seule à 18 h, pour la nuit suivante.',
      action_url: '/dispatch',
    }).catch(e => console.error('[reserve-notif] notif dispatchers échouée', e?.message))
  }

  return NextResponse.json({ ok: true, enabled: body.enabled, nightKey: night.nightKey })
}

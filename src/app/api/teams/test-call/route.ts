// src/app/api/teams/test-call/route.ts
//
// POST /api/teams/test-call { to?: string }
//
// Outil de test pour valider la chaine Teams Phone PSTN.
// Si `to` n'est pas fourni, appelle le numero du user connecte (users.phone).
//
// Reserve admin/superadmin pour eviter les abus de coûts.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { initiatePstnCall }  from '@/lib/teams/call'
import { getBusinessText }   from '@/lib/settings/business'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userId = (session.user as any).id

  let body: any = {}
  try { body = await req.json() } catch { /* body vide OK */ }

  // Simulation de l'appel du dépannage pour une nouvelle demande de l'espace client
  // (EBAC, Centracar…) : même chaîne que l'appel réel, message joué au décroché puis
  // raccroché. Olivier 13/10/2026 : faire écouter le résultat à Momo.
  const AUDIOS: Record<string, string> = { ebac: 'espace-demande-ebac.wav', centracar: 'espace-demande-centracar.wav' }
  if (body.message && AUDIOS[body.message]) {
    const sb = createAdminClient()
    let numero = ''
    try { numero = (await getBusinessText('espace_client_appel_numero')).replace(/[\s./-]/g, '') } catch {}
    if (!/^\+\d{8,15}$/.test(numero)) return NextResponse.json({ error: 'Numéro du dépannage non réglé (espace_client_appel_numero)' }, { status: 400 })
    const r = await initiatePstnCall({ toPhone: numero, toDisplayName: 'Dépannage' })
    await sb.from('espace_appels').insert({ mission_id: '00000000-0000-0000-0000-000000000000', call_id: r.callId || null, audio: AUDIOS[body.message], status: r.ok ? 'lance' : 'echec', detail: r.ok ? `test ${body.message}` : String(r.error || '').slice(0, 300) })
    return NextResponse.json(r)
  }

  // Appel « erreur signalée à Sam / Sonic » (Olivier 26/10/2026) : fait sonner les comptes du réglage
  // signalement_appel_user_ids avec le même message qu'un vrai signalement.
  if (body.message === 'signalement') {
    const sb = createAdminClient()
    const { getBusinessList } = await import('@/lib/settings/business')
    const { toE164 } = await import('@/lib/missions/market-proposals')
    const ids = await getBusinessList('signalement_appel_user_ids').catch(() => [] as string[])
    const { data: qui } = await sb.from('users').select('id, name, phone').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    const res: any[] = []
    for (const p of qui || []) {
      const e164 = toE164(p.phone)
      if (!e164) { res.push({ nom: p.name, ok: false, error: 'pas de numéro' }); continue }
      const r = await initiatePstnCall({ toPhone: e164, toDisplayName: p.name || 'Mobi' })
      await sb.from('espace_appels').insert({ mission_id: '00000000-0000-0000-0000-000000000000', call_id: r.callId || null, audio: 'erreur-signalee.wav', status: r.ok ? 'lance' : 'echec', detail: r.ok ? 'test signalement' : String(r.error || '').slice(0, 300) })
      res.push({ nom: p.name, ok: r.ok, error: r.ok ? undefined : r.error })
    }
    if (!res.length) return NextResponse.json({ error: 'Personne à appeler (réglage signalement_appel_user_ids)' }, { status: 400 })
    return NextResponse.json({ ok: res.every(x => x.ok), appels: res }, { status: res.some(x => x.ok) ? 200 : 502 })
  }

  let toPhone = (body.to || '').trim()
  let toDisplayName: string | undefined = body.toName

  // Si pas fourni, on lookup le phone du user connecte
  if (!toPhone) {
    const sb = createAdminClient()
    const { data: user } = await sb
      .from('users')
      .select('phone, name')
      .eq('id', userId)
      .maybeSingle()
    if (!user?.phone) {
      return NextResponse.json({
        error: 'Pas de phone fourni dans le body ET pas de phone configure sur ton user',
      }, { status: 400 })
    }
    toPhone = user.phone
    toDisplayName = user.name || 'Toi'
  }

  const result = await initiatePstnCall({ toPhone, toDisplayName })

  return NextResponse.json(result)
}

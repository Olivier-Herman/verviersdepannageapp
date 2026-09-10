// src/app/api/admin/axa/route.ts
//
// Pilotage de la connexion go&assist (superadmin). Audit 10/09/2026.
//   GET  → santé du poll + clôtures non poussées + date du jeton.
//   POST { action: 'seed', token }  → réamorce le refresh token 'web' et le
//                                     valide tout de suite (échange + liste).
//   POST { action: 'test' }         → un tour de poll en lecture seule.
//   POST { action: 'retry_closures' } → rejoue les clôtures en échec (10 max).
// Le jeton n'est jamais journalisé ni renvoyé.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { setAxaRefreshToken, getAxaAccessToken } from '@/lib/axa/auth'
import { getMissions, getMe, listKnownTechnicians, AXA_TECH_SETTING } from '@/lib/axa/goassist'
import { runAxaImport }      from '@/lib/axa/import'
import { closeAxaBg }        from '@/lib/axa/close-bg'
import { readAxaHealth, recordAxaPollResult } from '@/lib/axa/health'

function isSuperadmin(session: any): boolean {
  return session?.user?.role === 'superadmin'
    || (Array.isArray(session?.user?.roles) && session.user.roles.includes('superadmin'))
}

async function failedClosures(sb: any) {
  // Fiches liées à go&assist, terminées chez nous, jamais clôturées côté AXA,
  // avec au moins une erreur de synchro (60 j).
  const since = new Date(Date.now() - 60 * 86400e3).toISOString()
  const { data: logs } = await sb.from('mission_logs').select('mission_id').eq('action', 'axa_sync_error').gte('created_at', since)
  const ids = Array.from(new Set<string>((logs || []).map((l: any) => l.mission_id).filter(Boolean)))
  if (!ids.length) return []
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, axa_mission_order_id, status, completed_at, vehicle_plate, mission_type')
    .in('id', ids).in('status', ['completed', 'to_invoice', 'invoiced']).is('axa_closed_at', null).not('axa_mission_order_id', 'is', null)
    .order('completed_at', { ascending: false })
  return data || []
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const [health, closures, tok] = await Promise.all([
    readAxaHealth(sb), failedClosures(sb),
    sb.from('app_settings').select('value').eq('key', 'axa_auth_web').maybeSingle(),
  ])
  let tokenUpdatedAt: string | null = null
  try { tokenUpdatedAt = JSON.parse(tok.data?.value || '{}')?.updated_at || null } catch {}
  let me: any = null, technicians: any[] = [], gaStatus = new Map<string, string>()
  if (health?.ok) {
    try { me = await getMe() } catch {}
    try { technicians = await listKnownTechnicians() } catch {}
    try { for (const m of await getMissions()) if (m.missionOrderId) gaStatus.set(m.missionOrderId, m.status) } catch {}
  }
  const { data: techRow } = await sb.from('app_settings').select('value').eq('key', AXA_TECH_SETTING).maybeSingle()
  let technician: string | null = null
  try { technician = techRow?.value ? JSON.parse(techRow.value) : null } catch { technician = techRow?.value || null }
  // Statut go&assist de chaque clôture en attente : AXA auto-clôture à 3 j →
  // celles déjà « Completed/Closed » chez eux n'ont plus rien à recevoir.
  const withStatus = closures.map((c: any) => ({ ...c, ga_status: gaStatus.get(c.axa_mission_order_id) || null }))
  return NextResponse.json({ health, failed_closures: withStatus, token_updated_at: tokenUpdatedAt, me, technicians, technician })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isSuperadmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()

  if (body.action === 'seed') {
    const token = String(body.token || '').trim().replace(/^["']|["']$/g, '')
    if (token.length < 20) return NextResponse.json({ error: 'Jeton vide ou trop court.' }, { status: 400 })
    await setAxaRefreshToken('web', token)
    try {
      await getAxaAccessToken('web')          // échange + rotation persistée
      const missions = await getMissions()
      const me = await getMe().catch(() => null)
      await recordAxaPollResult({ ok: true, awaiting: undefined })
      return NextResponse.json({ ok: true, missions: missions.length, me })
    } catch (e: any) {
      return NextResponse.json({ error: `Jeton refusé par AXA : ${e?.message || e}` }, { status: 400 })
    }
  }

  if (body.action === 'test') {
    try {
      const r = await runAxaImport({ mode: 'preview' })
      await recordAxaPollResult({ ok: true, awaiting: r.awaiting })
      return NextResponse.json({ ok: true, awaiting: r.awaiting, news: r.news, items: r.items.slice(0, 20) })
    } catch (e: any) {
      await recordAxaPollResult({ ok: false, error: e?.message })
      return NextResponse.json({ error: e?.message || 'échec' }, { status: 400 })
    }
  }

  if (body.action === 'set_technician') {
    const id = String(body.auth0Id || '').trim()
    if (id && !id.startsWith('auth0|')) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 })
    if (id) await sb.from('app_settings').upsert({ key: AXA_TECH_SETTING, value: JSON.stringify(id) }, { onConflict: 'key' })
    else await sb.from('app_settings').delete().eq('key', AXA_TECH_SETTING)
    return NextResponse.json({ ok: true, technician: id || null })
  }

  if (body.action === 'retry_closures') {
    const all = await failedClosures(sb)
    const actorId = (session as any)?.user?.id || null
    // Statut côté AXA : une mission déjà terminée/clôturée chez eux (auto-clôture
    // à 3 j) ne peut plus recevoir de pointage → on la marque et on passe.
    const gaStatus = new Map<string, string>()
    try { for (const m of await getMissions()) if (m.missionOrderId) gaStatus.set(m.missionOrderId, m.status) } catch {}
    const results: any[] = []
    let autoclosed = 0, tried = 0
    for (const m of all) {
      const st = gaStatus.get(m.axa_mission_order_id) || null
      if (st && !/^(New|AwaitingDispatch|Dispatched|InProgress|Accepted|Started)$/i.test(st)) {
        await sb.from('incoming_missions').update({ axa_closed_at: new Date().toISOString() }).eq('id', m.id)
        await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: actorId, action: 'axa_synced', notes: `AXA : mission déjà « ${st} » côté go&assist (auto-clôture) — plus rien à pousser.`, metadata: { ga_status: st } }).then(() => {}, () => {})
        autoclosed++; continue
      }
      if (tried >= 10) break
      tried++
      const r = await closeAxaBg(m.id, m.axa_mission_order_id, actorId, sb).catch((e: any) => ({ ok: false, error: e?.message }))
      results.push({ mission_number: m.mission_number, ga_status: st, ...r })
    }
    return NextResponse.json({ ok: true, tried, autoclosed, results })
  }

  return NextResponse.json({ error: 'action inconnue' }, { status: 400 })
}

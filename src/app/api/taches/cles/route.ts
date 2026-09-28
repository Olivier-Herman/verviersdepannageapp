// src/app/api/taches/cles/route.ts
//
// Clés déposées en digibox, à récupérer par le bureau fourrière (Olivier
// 28/09/2026). Les tâches naissent en base (trigger digibox_key_task) quand
// une clé passe en digibox, et se ferment quand elle en sort.
//
// GET  → les clés à récupérer (+ celles rangées ces dernières 24 h).
// POST { missionId, answer: 'hook'|'office'|'in_vehicle', hook? } → range la
//      clé : la fiche est mise à jour, le trigger clôt la tâche.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tachesAccess } from '@/lib/taches/access'
import { KEY_LOCATION_LABELS } from '@/lib/key-location'

export const dynamic = 'force-dynamic'

const ANSWER_TO_KEY: Record<string, string> = { hook: 'bureau_rac', office: 'bureau_rac', in_vehicle: 'in_vehicle' }

export async function GET() {
  const acc = await tachesAccess()
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: runs, error } = await sb.from('process_runs')
    .select('mission_id, status, answers, started_at, completed_at')
    .eq('process_key', 'digibox_key')
    .or(`status.eq.todo,completed_at.gte.${since}`)
    .order('started_at', { ascending: false }).limit(80)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (runs || []).map(r => r.mission_id)
  const { data: ms } = ids.length
    ? await sb.from('incoming_missions').select('id, vehicle_plate, vehicle_brand, vehicle_model, key_location, keys_digibox_slot, saisie_key_hook, parc_zone_key, status, assigned_to').in('id', ids)
    : { data: [] as any[] }
  const drivers = [...new Set((ms || []).map((m: any) => m.assigned_to).filter(Boolean))] as string[]
  const { data: us } = drivers.length ? await sb.from('users').select('id, name').in('id', drivers) : { data: [] as any[] }
  const mBy = new Map((ms || []).map((m: any) => [m.id, m]))
  const uBy = new Map((us || []).map((u: any) => [u.id, u.name]))
  const rows = (runs || []).map((r: any) => {
    const m: any = mBy.get(r.mission_id) || {}
    return {
      missionId: r.mission_id, status: r.status, since: r.started_at, doneAt: r.completed_at,
      plate: m.vehicle_plate || null, model: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '),
      digibox: KEY_LOCATION_LABELS[r.answers?.from || m.key_location] || r.answers?.from || m.key_location, slot: m.keys_digibox_slot || null,
      zone: m.parc_zone_key || null, driver: m.assigned_to ? uBy.get(m.assigned_to) || null : null,
      rangement: r.status === 'done' ? (r.answers?.hook ? `crochet n° ${r.answers.hook}` : KEY_LOCATION_LABELS[r.answers?.to] || r.answers?.to || '—') : null,
    }
  })
  return NextResponse.json({ todo: rows.filter(r => r.status === 'todo'), done: rows.filter(r => r.status === 'done') })
}

export async function POST(req: Request) {
  const acc = await tachesAccess()
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { missionId?: string; answer?: string; hook?: string }
  const to = ANSWER_TO_KEY[String(body.answer)]
  if (!body.missionId || !to) return NextResponse.json({ error: 'Réponse inconnue' }, { status: 400 })
  const hook = body.answer === 'hook' ? String(body.hook || '').trim() : ''
  if (body.answer === 'hook' && !hook) return NextResponse.json({ error: 'N° de crochet manquant' }, { status: 400 })
  const sb = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await sb.from('incoming_missions').update({
    key_location: to, saisie_key_hook: hook || null, keys_digibox_slot: null, updated_at: now,
  }).eq('id', body.missionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from('mission_logs').insert({
    mission_id: body.missionId, actor_id: acc.userId, action: 'key_location',
    notes: `Clé récupérée en digibox et rangée : ${hook ? `crochet n° ${hook}` : KEY_LOCATION_LABELS[to] || to}`,
    metadata: { key_location: to, hook: hook || null, from: 'digibox' },
  }).then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}

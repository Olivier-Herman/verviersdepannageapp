// src/app/api/taches/vehicules/route.ts
//
// GET /api/taches/vehicules — les véhicules arrivés au parc sur appel police
// (accident), avec l'état de leur prise en charge. C'est l'écran 1 du module
// Tâches (Olivier 28/09/2026) : « on prend en charge le véhicule ».

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tachesAccess } from '@/lib/taches/access'
import { nextStep, progress, STEP_LABELS, type Answers, type Reading } from '@/lib/taches/accident-steps'
import { getFlagAppliesFrom } from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

export async function GET() {
  const acc = await tachesAccess()
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()

  // Véhicules en parc sur appel police accident (fiches principales, pas les volets).
  const { data: parked, error } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key, parc_row_number, parked_at, assigned_to, police_zone, officer_name, client_phone, client_email, label_printed_at')
    .eq('status', 'parked').eq('source', 'police_accident').eq('dossier_leg', false)
    .order('parked_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (parked || []).map(m => m.id)
  const [{ data: runs }, { data: drivers }, { data: recentDone }] = await Promise.all([
    ids.length ? sb.from('process_runs').select('mission_id, status, answers, reading, completed_at, updated_at').eq('process_key', 'accident_police').in('mission_id', ids) : Promise.resolve({ data: [] as any[] }),
    sb.from('users').select('id, name').in('id', [...new Set((parked || []).map(m => m.assigned_to).filter(Boolean))] as string[]),
    sb.from('process_runs').select('mission_id, completed_at, answers').eq('process_key', 'accident_police').eq('status', 'done').gte('completed_at', new Date(Date.now() - 7 * 86400_000).toISOString()),
  ])
  const runBy = new Map<string, any>(); for (const r of (runs || []) as any[]) runBy.set(r.mission_id, r)
  const driverBy = new Map<string, string>(); for (const d of (drivers || []) as any[]) driverBy.set(d.id, d.name)

  const vehicles = (parked || []).map((m: any) => {
    const run = runBy.get(m.id)
    const a: Answers = run?.answers || {}
    const reading: Reading | null = run?.reading || null
    const next = nextStep(a, reading, m)
    const p = progress(a, reading, m)
    return {
      id: m.id, mission_number: m.mission_number, plate: m.vehicle_plate, model: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '),
      zone: m.parc_zone_key, row: m.parc_row_number, parked_at: m.parked_at, driver: m.assigned_to ? driverBy.get(m.assigned_to) || null : null,
      police: [m.police_zone, m.officer_name].filter(Boolean).join(' · '),
      status: run?.status || 'todo', started: !!run, next, next_label: next ? STEP_LABELS[next] : null, done: p.done, total: p.total,
      completed_at: run?.completed_at || null,
    }
  })
  // Coupure : la date de mise en route du module (réglage « applies_from » du
  // drapeau taches_accident). Les véhicules déposés AVANT et pas encore pris en
  // charge forment le STOCK, repris au rythme de la fourrière, hors objectif du
  // jour — sinon la liste démarre à 58 et ne tombe jamais à zéro (28/09/2026).
  const cutoff = await getFlagAppliesFrom('taches_accident')
  const isStock = (v: any) => !v.started && !!cutoff && !!v.parked_at && v.parked_at < cutoff
  const todo = vehicles.filter(v => v.status === 'todo' && !isStock(v))
  const stock = vehicles.filter(v => v.status === 'todo' && isStock(v))
  const waiting = vehicles.filter(v => v.status === 'waiting_owner')
  const done = vehicles.filter(v => v.status === 'done')
  return NextResponse.json({ todo, stock, waiting, done, cutoff, doneCount7d: (recentDone || []).length })
}

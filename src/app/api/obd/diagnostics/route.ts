// /api/obd/diagnostics — fiches de diagnostic OBD (Olivier 05/11/2026). Préversion : drapeau « obd_diagnostic ».
//   POST { mission_id?, vin?, vin_source?, plate?, codes, measures, adapter } → enregistre la lecture TOUT DE SUITE
//        (avant tout avis ou effacement), décode le VIN, propose les interventions du même véhicule.
//   GET  → journal du bureau (100 dernières fiches).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { obdAccess, decodeVin, matchingMissions, corrigerCarburantFiche, familleBoite, noterCalculateurs } from '@/lib/obd/server'
import { cleanVin, checkVin } from '@/lib/obd/vin'
import { nomSysteme } from '@/lib/obd/calculateurs'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!(await obdAccess(user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const vin = b.vin ? cleanVin(b.vin) : null
  if (vin && !checkVin(vin).valid) return NextResponse.json({ error: 'Numéro de châssis invalide' }, { status: 400 })
  const codes = (Array.isArray(b.codes) ? b.codes : []).filter((c: any) => /^[PCBU][0-3][0-9A-F]{3}$/.test(String(c?.code))).map((c: any) => ({ code: String(c.code), type: ['en_attente', 'permanent'].includes(c.type) ? c.type : 'memorise', ecu: c.ecu ? String(c.ecu).slice(0, 8) : null,
      ...(c.systeme ? { systeme: String(c.systeme).slice(0, 20), detail: c.detail ? String(c.detail).slice(0, 4) : null, actif: !!c.actif, nom: c.nom ? String(c.nom).slice(0, 40) : null } : {}) }))
  let missionId: string | null = typeof b.mission_id === 'string' ? b.mission_id : null
  let plate = b.plate ? String(b.plate).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) : null
  if (missionId) {
    const { data: m } = await sb.from('incoming_missions').select('id, vehicle_plate').eq('id', missionId).maybeSingle()
    if (!m) missionId = null; else plate = plate || m.vehicle_plate || null
  }
  let vehicle = vin ? await decodeVin(vin) : null
  let boite: 'manuelle' | 'automatique' | null = null
  // Le modèle donné par l'assistance sur la fiche vaut mieux qu'une estimation (Olivier 06/11/2026).
  if (missionId) {
    const { data: fiche } = await sb.from('incoming_missions').select('vehicle_brand, vehicle_model, vehicle_gearbox').eq('id', missionId).maybeSingle()
    boite = familleBoite((fiche as any)?.vehicle_gearbox)
    if ((fiche as any)?.vehicle_model) vehicle = { marque: (fiche as any).vehicle_brand || vehicle?.marque || null, modele: (fiche as any).vehicle_model, motorisation: vehicle?.motorisation || null, annee: vehicle?.annee || null, source: vehicle?.source || 'vin' }
  }
  const { data: row, error } = await sb.from('obd_diagnostics').insert({
    mission_id: missionId, vin, vin_source: vin ? (['obd', 'photo', 'saisie'].includes(b.vin_source) ? b.vin_source : 'saisie') : null,
    plate, vehicle, codes, measures: b.measures || {}, adapter: b.adapter ? String(b.adapter).slice(0, 60) : null, created_by: user.id,
    protocol: b.protocol ? String(b.protocol).slice(0, 8) : null, lecture: b.lecture || null, image_figee: b.freeze || null, raw: Array.isArray(b.raw) ? b.raw.slice(0, 120) : null,
  }).select('id, numero').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await noterCalculateurs(sb, row.id, vin, b.measures).catch(() => {})
  if (missionId) {
    await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: user.id, action: 'obd_diagnostic',
      notes: `Diagnostic OBD ${row.numero} : ${codes.length ? codes.map((c: any) => c.code + (c.systeme ? ` ${nomSysteme(c.systeme, 'fr', c.ecu)}` : '') + (c.type === 'en_attente' ? ' (en attente)' : c.type === 'permanent' ? ' (permanent)' : '')).join(', ') : b.lecture?.complete === false ? 'lecture incomplète, codes non confirmés' : 'aucun code de panne'}${vin ? ` · VIN ${vin}` : ''}`,
      metadata: { diagnostic_id: row.id } }).then(() => {}, () => {})
    // Le VIN lu par le boîtier complète la fiche s'il manque.
    if (vin) await sb.from('incoming_missions').update({ vehicle_vin: vin }).eq('id', missionId).is('vehicle_vin', null).then(() => {}, () => {})
    await corrigerCarburantFiche(sb, missionId, b.measures, row.numero, user.id).catch(() => {})
  }
  const propositions = missionId ? [] : await matchingMissions(sb, vin, plate)
  return NextResponse.json({ ok: true, id: row.id, numero: row.numero, vehicle, boite, propositions })
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!(await obdAccess(user))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const sb = createAdminClient()
  const { data } = await sb.from('obd_diagnostics').select('*').order('created_at', { ascending: false }).limit(100)
  const ids = [...new Set((data || []).flatMap((d: any) => [d.created_by, d.cleared_by]).filter(Boolean))]
  const mids = [...new Set((data || []).map((d: any) => d.mission_id).filter(Boolean))]
  const [{ data: us }, { data: ms }] = await Promise.all([
    ids.length ? sb.from('users').select('id, name').in('id', ids) : Promise.resolve({ data: [] as any[] }),
    mids.length ? sb.from('incoming_missions').select('id, mission_number').in('id', mids) : Promise.resolve({ data: [] as any[] }),
  ])
  const name: Record<string, string> = {}; for (const u of us || []) name[u.id] = u.name
  const num: Record<string, number> = {}; for (const m of ms || []) num[m.id] = m.mission_number
  return NextResponse.json({ ok: true, diagnostics: (data || []).map((d: any) => ({ ...d, created_by_name: name[d.created_by] || null, cleared_by_name: d.cleared_by ? name[d.cleared_by] || null : null, mission_number: d.mission_id ? num[d.mission_id] || null : null })) })
}

// src/app/api/fourriere/controle/[id]/route.ts
//
// Contrôle du parc (Olivier 21/10/2026).
//   GET  → état complet (écran de contrôle en direct, téléphones)
//   POST { action } :
//     scan      { zone, raw | mission_id, via? }  — une étiquette lue (ou une fiche choisie après photo)
//     photo     { base64, mimeType }               — photo de la plaque ou du châssis → fiches candidates
//     presence  { zone }                           — le téléphone annonce sa zone
//     zone      { zone }                           — « Zone terminée »
//     close                                        — « Tout est scanné » (analyse)
//     decide    { item_id, decision }              — décision sur une voiture (analyse)
//     apply                                        — applique les décisions
//     domaine                                      — transfère en zone Domaine les véhicules du Domaine scannés
// Accès : admin / superadmin / module fourrière.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { aiClient }          from '@/lib/ai/usage'
import { normalizePlate }    from '@/lib/plate'
import {
  scanControle, touchScanner, zoneDone, closeControle, applyDecisions, transferDomaine, DECISIONS, EXPECTED_STATUSES,
} from '@/lib/parc/controle'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function auth() {
  const session = await getServerSession(authOptions)
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok || !a.id) return null
  return { id: a.id, name: String((session?.user as any)?.name || 'fourrière').split(' ')[0] }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!(await auth())) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const { data: controle } = await sb.from('parc_controles').select('*').eq('id', params.id).maybeSingle()
  if (!controle) return NextResponse.json({ error: 'Contrôle introuvable' }, { status: 404 })
  const items: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('parc_controle_items')
      .select('id, mission_id, expected, expected_zone, plate, vehicle, mission_number, source, is_domaine, scanned_at, scanned_by_name, scanned_zone, result, moved_from, moved_to, via, analysis, decision, applied_at, applied_result')
      .eq('controle_id', params.id).order('id').range(from, from + 999)
    items.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const { data: zones } = await sb.from('parc_zones').select('key, label, sort_order').eq('active', true).order('sort_order')
  return NextResponse.json({ controle, items, zones: zones || [] })
}

async function ocrPhoto(base64: string, mimeType: string): Promise<{ plate: string | null; vin: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Lecture des photos indisponible')
  const client = aiClient('parc/controle-photo', { apiKey })
  const resp = await createWithModelFallback(client, ANTHROPIC_MODELS, {
    max_tokens: 200,
    system: 'Tu lis des photos de véhicules prises sur un parc de fourrière. Retourne UNIQUEMENT un JSON {"plate": string|null, "vin": string|null} : la plaque d’immatriculation telle qu’écrite (sans espaces ni tirets) et/ou le numéro de châssis (VIN, 17 caractères) s’il est lisible. null si illisible.',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
      { type: 'text', text: 'Lis la plaque et/ou le numéro de châssis.' },
    ] }],
  })
  const text = (resp.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  try {
    const j = JSON.parse(text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim())
    const plate = j.plate ? normalizePlate(String(j.plate)) : null
    const vin = j.vin ? String(j.vin).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null
    return { plate: plate && plate.length >= 3 ? plate : null, vin: vin && vin.length >= 6 ? vin : null }
  } catch { return { plate: null, vin: null } }
}

async function candidates(sb: ReturnType<typeof createAdminClient>, plate: string | null, vin: string | null) {
  const F = 'id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, parc_zone_key, status'
  const found = new Map<string, any>()
  const add = (rows: any[] | null) => (rows || []).forEach(r => found.set(r.id, r))
  if (plate) add((await sb.from('incoming_missions').select(F).eq('dossier_leg', false).eq('vehicle_plate', plate).order('updated_at', { ascending: false }).limit(5)).data)
  if (plate && plate.length >= 5 && found.size === 0) add((await sb.from('incoming_missions').select(F).eq('dossier_leg', false).ilike('vehicle_plate', `%${plate.slice(-5)}%`).in('status', EXPECTED_STATUSES).limit(5)).data)
  if (vin) add((await sb.from('incoming_missions').select(F).eq('dossier_leg', false).ilike('vehicle_vin', vin.length === 17 ? vin : `%${vin}`).order('updated_at', { ascending: false }).limit(5)).data)
  return Array.from(found.values())
    .sort((a, b) => Number(EXPECTED_STATUSES.includes(b.status)) - Number(EXPECTED_STATUSES.includes(a.status)))
    .slice(0, 6)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const by = await auth()
  if (!by) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({})) as any
  const zone = String(body.zone || '').trim()
  try {
    switch (body.action) {
      case 'scan': {
        if (!zone) return NextResponse.json({ error: 'Choisissez d’abord votre zone.' }, { status: 400 })
        const r = await scanControle(sb, params.id, by, zone, { raw: body.raw, missionId: body.mission_id, via: body.via, photoPath: body.photo_path })
        return NextResponse.json({ ok: true, ...r })
      }
      case 'photo': {
        if (!body.base64 || !String(body.mimeType || '').startsWith('image/')) return NextResponse.json({ error: 'Photo manquante' }, { status: 400 })
        const path = `controle-parc/${params.id}/${Date.now()}.jpg`
        await sb.storage.from('mission-remarks').upload(path, Buffer.from(body.base64, 'base64'), { contentType: body.mimeType, upsert: false }).catch(() => null)
        const lu = await ocrPhoto(body.base64, body.mimeType)
        const list = await candidates(sb, lu.plate, lu.vin)
        return NextResponse.json({ ok: true, ...lu, photo_path: path, candidates: list })
      }
      case 'presence': await touchScanner(sb, params.id, by, zone); return NextResponse.json({ ok: true })
      case 'zone': await zoneDone(sb, params.id, by, zone); return NextResponse.json({ ok: true })
      case 'close': await closeControle(sb, params.id, by); return NextResponse.json({ ok: true })
      case 'decide': {
        const d = body.decision === null ? null : String(body.decision || '')
        if (d !== null && !(DECISIONS as readonly string[]).includes(d)) return NextResponse.json({ error: 'Décision inconnue' }, { status: 400 })
        const ids: string[] = Array.isArray(body.item_ids) ? body.item_ids : [body.item_id]
        await sb.from('parc_controle_items').update({ decision: d, decision_at: new Date().toISOString(), decision_by: by.id }).eq('controle_id', params.id).in('id', ids).is('applied_at', null)
        return NextResponse.json({ ok: true })
      }
      case 'apply': return NextResponse.json({ ok: true, results: await applyDecisions(sb, params.id, by) })
      case 'domaine': return NextResponse.json({ ok: true, count: await transferDomaine(sb, params.id, by) })
      default: return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }
}

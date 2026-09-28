// src/app/api/fourriere/gardiennage/route.ts
//
// Fiche gardiennage à l'arrivée (Olivier 28/09/2026) : un transporteur
// externe dépose un véhicule chez nous. Pas de remorquage ; le véhicule reste
// en gardiennage (source « gardiennage », régime « autre » de la grille) jusqu'à
// la décision d'un client ou d'une assistance, prise ensuite sur la fiche.
// Maquette validée : https://claude.ai/artifact/5S8kKA11FRYQKt5ddyN52J
//
// GET  → zones du parc, assistances, derniers transporteurs, tarif du régime.
// POST → crée la fiche (statut au parc), imprime l'étiquette, trace le journal.
// POST ?ocr=1 { images } → plaque / châssis lus sur les photos prises.
// « Pour qui » inconnu → client facturable = Client divers, celui du catalogue
// « Privé » (Olivier 28/09/2026 : « le client devient automatiquement Client
// divers quand on ne sait pas »).
// Accès : module Fourrière ou admin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { getGardiennageRegimes } from '@/lib/tarifs/gardiennage-regimes'
import { KEY_LOCATION_LABELS } from '@/lib/key-location'
import { reprintLabelForMission } from '@/lib/missions/reprint-label-helper'
import { detectVehicleFromImages } from '@/lib/ocr/vehicle-detect'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REGIME = 'autre'
const KEY_TO_FICHE: Record<string, string> = { in_vehicle: 'in_vehicle', hook: 'bureau_rac', office: 'bureau_rac', no_key: 'no_key' }

async function access() {
  const session = await getServerSession(authOptions)
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  return { session, a }
}

export async function GET() {
  const { a } = await access()
  if (!a.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const [{ data: zones }, { data: cat }, { data: logs }, regimes] = await Promise.all([
    sb.from('parc_zones').select('key, label, sort_order').eq('active', true).order('sort_order'),
    sb.from('mission_source_catalog').select('key, label, default_billed_to_id, default_billed_to_name').eq('active', true).not('default_billed_to_id', 'is', null).order('sort_order'),
    sb.from('mission_logs').select('metadata').eq('action', 'gardiennage_arrival').order('created_at', { ascending: false }).limit(60),
    getGardiennageRegimes().catch(() => []),
  ])
  const transporters: string[] = []
  for (const l of logs || []) {
    const t = String((l as any).metadata?.transporter || '').trim()
    if (t && !transporters.some(x => x.toLowerCase() === t.toLowerCase())) transporters.push(t)
    if (transporters.length >= 6) break
  }
  const rate = regimes.find(r => r.regime === REGIME) || null
  return NextResponse.json({
    zones: zones || [],
    assisteurs: ((cat || []) as any[]).filter(c => !/^(police|prive|gardiennage|garage)/.test(c.key)).map(c => ({ key: c.key, label: c.label })),
    transporters,
    rate: rate ? { htva: rate.price_htva, tvac: rate.price_tvac, free_days: rate.free_days } : null,
  })
}

export async function POST(req: Request) {
  const { session, a } = await access()
  if (!a.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const u = (session!.user as any) || {}
  const b = await req.json().catch(() => ({})) as Record<string, any>

  // Lecture plaque / châssis sur les photos (avant création de la fiche).
  if (new URL(req.url).searchParams.get('ocr') === '1') {
    const images = (Array.isArray(b.images) ? b.images : []).filter((x: any) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 6)
    if (!images.length) return NextResponse.json({ error: 'Aucune photo à lire.' }, { status: 400 })
    try {
      const r = await detectVehicleFromImages(images)
      return NextResponse.json({ plate: r.plate?.value || null, vin: r.vin?.value || null })
    } catch (e: any) { return NextResponse.json({ error: `Lecture impossible : ${e?.message || 'erreur'}` }, { status: 502 }) }
  }

  const s = (v: any, max = 200) => String(v ?? '').trim().slice(0, max)

  const plate = s(b.plate, 20).toUpperCase().replace(/[\s.]/g, '')
  const vin = s(b.vin, 17).toUpperCase()
  const transporter = s(b.transporter, 120)
  if (!plate && !vin) return NextResponse.json({ error: 'Plaque ou numéro de châssis requis.' }, { status: 400 })
  if (!transporter) return NextResponse.json({ error: 'Indiquez qui apporte le véhicule.' }, { status: 400 })

  const sb = createAdminClient()
  const zone = s(b.zone, 20)
  if (zone) {
    const { data: z } = await sb.from('parc_zones').select('key').eq('key', zone).eq('active', true).maybeSingle()
    if (!z) return NextResponse.json({ error: `Zone « ${zone} » inconnue.` }, { status: 400 })
  }

  // Pour qui : inconnu (défaut), une assistance du catalogue, ou un client.
  let billedToId: number | null = null, billedToName: string | null = null, forLabel = 'à déterminer'
  if (b.for === 'assist' && b.assist) {
    const { data: c } = await sb.from('mission_source_catalog').select('key, label, default_billed_to_id, default_billed_to_name').eq('key', s(b.assist, 60)).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Assistance inconnue.' }, { status: 400 })
    billedToId = (c as any).default_billed_to_id || null; billedToName = (c as any).default_billed_to_name || (c as any).label
    forLabel = (c as any).label
  } else if (b.for === 'client' && s(b.client)) {
    billedToName = s(b.client); forLabel = billedToName
  } else {
    const { data: divers } = await sb.from('mission_source_catalog').select('default_billed_to_id, default_billed_to_name').eq('key', 'prive').maybeSingle()
    billedToId = (divers as any)?.default_billed_to_id || null
    billedToName = (divers as any)?.default_billed_to_name || null
    forLabel = `à déterminer${billedToName ? ` (facturé à ${billedToName} en attendant)` : ''}`
  }

  const key = KEY_TO_FICHE[String(b.key || '')] || null
  const hook = b.key === 'hook' ? s(b.hook, 20) || null : null
  const cmr = s(b.cmr, 60), from = s(b.from, 120), remark = s(b.remark, 1000)
  const now = new Date().toISOString()
  const remarks = [`Apporté par ${transporter}${cmr ? ` (bon ${cmr})` : ''}${from ? ` — provenance ${from}` : ''}`, remark].filter(Boolean).join(' · ')

  const { data: created, error } = await sb.from('incoming_missions').insert({
    external_id:       `GARD-${plate || vin}-${Date.now().toString(36).toUpperCase()}`,
    source:            'gardiennage',
    source_format:     'gardiennage_arrival',
    mission_type:      REGIME,
    vehicle_plate:     plate || null,
    vehicle_vin:       vin || null,
    vehicle_brand:     s(b.brand, 60) || null,
    vehicle_model:     s(b.model, 60) || null,
    billed_to_id:      billedToId,
    billed_to_name:    billedToName,
    dossier_number:    b.for === 'assist' ? (s(b.assistRef, 60) || null) : null,
    remarks_general:   remarks,
    key_location:      key,
    saisie_key_hook:   hook,
    parc_zone_key:     zone || null,
    status:            'parked',
    dispatch_mode:     'manual',
    parked_at:         now,
    received_at:       now,
    intervention_date: now,
    parse_confidence:  1.0,
    parsed_data:       { confidence: 1.0, created_manually_by: u.name || null, odoo_vehicle_id: Number(b.odooVehicleId) || null },
  }).select('id, mission_number').single()
  if (error || !created) return NextResponse.json({ error: `Création impossible : ${error?.message || 'inconnue'}` }, { status: 500 })

  const who = u.name || u.email || 'utilisateur'
  await sb.from('mission_logs').insert({
    mission_id: created.id, actor_id: a.id, action: 'gardiennage_arrival',
    notes: `Véhicule déposé au parc par ${transporter}${cmr ? ` (bon ${cmr})` : ''} — gardiennage en attente de décision, pour : ${forLabel}${zone ? ` — zone ${zone}` : ''}${key ? ` — clé : ${KEY_LOCATION_LABELS[key] || key}${hook ? ` n° ${hook}` : ''}` : ''}. Encodé par ${who}.`,
    metadata: { transporter, cmr: cmr || null, from: from || null, for: b.for || 'unknown', billed_to_name: billedToName },
  }).then(() => {}, () => {})

  // Étiquette parc : jamais bloquante (un PC Zebra éteint se voit sur la fiche).
  const label = await reprintLabelForMission({ kind: 'uuid', value: created.id }).catch((e: any) => ({ ok: false, error: e?.message }))

  return NextResponse.json({ ok: true, id: created.id, mission_number: created.mission_number, label_ok: !!label?.ok, label_error: label?.ok ? null : (label as any)?.error || null })
}

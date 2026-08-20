// src/app/api/admin/ventes/route.ts
//
// GET  /api/admin/ventes        → liste des lots + nombre d'offres
// POST /api/admin/ventes        → crée un lot
//        { mission_id }         → depuis une fiche (abandon) : marque, modèle,
//                                 VIN, plaque et photos repris automatiquement ;
//        sinon                  → lot vierge (véhicule racheté d'occasion).
//
// Un véhicule en SAISIE POLICE ne peut pas entrer en vente : il ne nous
// appartient pas, il part par le SPF Domaine. Même règle que l'abandon
// (cf /api/missions/[id]/abandon). Olivier 2026-08-20.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MODULES = ['ventes', 'facturation']

async function guard() {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: MODULES })
  return acc.ok ? acc : null
}

const str = (v: any, max = 300) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export async function GET(req: Request) {
  const acc = await guard()
  if (!acc) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const status = new URL(req.url).searchParams.get('status')
  const sb = createAdminClient()

  let q = sb.from('vehicle_sales').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data: sales, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Compteur d'offres par lot, en une seule requête plutôt qu'une par ligne.
  const ids = (sales || []).map(s => s.id)
  const counts: Record<string, { total: number; confirmed: number; best: number | null }> = {}
  if (ids.length) {
    const { data: bids } = await sb
      .from('vehicle_sale_bids')
      .select('sale_id, amount, status')
      .in('sale_id', ids)
    for (const b of bids || []) {
      const c = counts[b.sale_id] || (counts[b.sale_id] = { total: 0, confirmed: 0, best: null })
      c.total++
      if (b.status === 'confirmed' || b.status === 'awarded') {
        c.confirmed++
        c.best = c.best == null ? Number(b.amount) : Math.max(c.best, Number(b.amount))
      }
    }
  }

  return NextResponse.json({
    sales: (sales || []).map(s => ({ ...s, bids: counts[s.id] || { total: 0, confirmed: 0, best: null } })),
  })
}

export async function POST(req: Request) {
  const acc = await guard()
  if (!acc) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const sb = createAdminClient()
  const missionId = str(body.mission_id, 60)

  let seed: Record<string, any> = { origin: 'achat' }

  if (missionId) {
    const { data: m } = await sb
      .from('incoming_missions')
      .select('id, source, vehicle_brand, vehicle_model, vehicle_plate, vehicle_vin, vehicle_fuel, vehicle_gearbox, vehicle_mileage, is_rollable, driver_photos, abandon_at, mission_number')
      .eq('id', missionId)
      .maybeSingle()
    if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

    if ((m.source || '').toLowerCase().trim() === 'police_saisie') {
      return NextResponse.json({
        error: "Véhicule en saisie police : il ne peut pas être mis en vente ici. "
             + 'Ces véhicules passent par le SPF Domaine.',
      }, { status: 400 })
    }
    if (!m.abandon_at) {
      return NextResponse.json({
        error: "Cette fiche ne porte pas d'abandon. Enregistrez d'abord l'abandon du véhicule, "
             + 'sinon le véhicule ne nous appartient pas.',
      }, { status: 400 })
    }

    const { data: exists } = await sb.from('vehicle_sales').select('id, reference')
      .eq('mission_id', missionId).maybeSingle()
    if (exists) {
      return NextResponse.json({ error: `Déjà en vente sous la référence ${exists.reference}.` }, { status: 409 })
    }

    seed = {
      origin:     'abandon',
      mission_id: m.id,
      brand:      m.vehicle_brand,
      model:      m.vehicle_model,
      plate:      m.vehicle_plate,
      vin:        m.vehicle_vin,
      fuel:       m.vehicle_fuel,
      gearbox:    m.vehicle_gearbox,
      mileage:    m.vehicle_mileage,
      // is_rollable vaut null quand personne ne s'est prononcé : on ne devine pas.
      condition:  m.is_rollable === true ? 'roulant' : m.is_rollable === false ? 'non_roulant' : 'roulant',
      photos:     Array.isArray(m.driver_photos) ? m.driver_photos.slice(0, 12) : [],
    }
  }

  const title = str(body.title, 160)
    || [seed.brand, seed.model].filter(Boolean).join(' ')
    || 'Véhicule sans titre'

  const { data, error } = await sb.from('vehicle_sales').insert({
    ...seed,
    title,
    sale_mode:  ['fixed', 'sealed', 'auction'].includes(body.sale_mode) ? body.sale_mode : 'sealed',
    status:     'draft',
    created_by: acc.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sale: data })
}

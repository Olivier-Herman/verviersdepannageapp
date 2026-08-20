// src/app/api/admin/ventes/[id]/route.ts
//
// GET    /api/admin/ventes/[id]  → le lot + toutes ses offres (montants compris :
//                                  côté back-office on voit tout, c'est le public
//                                  qui ne voit rien en enveloppe fermée)
// PATCH  /api/admin/ventes/[id]  → mise à jour des champs, changement de statut,
//                                  attribution à une offre (`award_bid_id`)
// DELETE /api/admin/ventes/[id]  → supprime un lot resté en brouillon

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function guard() {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['ventes', 'facturation'] })
  return acc.ok ? acc : null
}

// Champs librement modifiables depuis l'écran d'édition.
const EDITABLE = [
  'title', 'brand', 'model', 'version', 'first_registration', 'mileage', 'mileage_source',
  'fuel', 'gearbox', 'power_kw', 'doors', 'color', 'plate', 'vin',
  'condition', 'destination', 'damage', 'ct_status', 'carpass', 'keys_count',
  'description', 'photos', 'sale_mode', 'price', 'reserve_price', 'start_price', 'bid_step',
  'opens_at', 'closes_at', 'depot_id', 'visit_info',
  'purchase_price', 'purchase_notes', 'sold_price',
] as const

const STATUSES = ['draft', 'published', 'closed', 'awarded', 'sold', 'withdrawn']

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const acc = await guard()
  if (!acc) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const sb = createAdminClient()
  const { data: sale, error } = await sb.from('vehicle_sales').select('*').eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!sale)  return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })

  // Tri par montant : c'est la seule lecture utile d'un carnet d'offres.
  const { data: bids } = await sb.from('vehicle_sale_bids')
    .select('*').eq('sale_id', params.id).order('amount', { ascending: false })

  return NextResponse.json({ sale, bids: bids || [] })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const acc = await guard()
  if (!acc) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const sb = createAdminClient()
  const { data: sale } = await sb.from('vehicle_sales').select('*').eq('id', params.id).maybeSingle()
  if (!sale) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })

  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k]

  // ── Attribution à une offre ──
  if (body.award_bid_id) {
    const { data: bid } = await sb.from('vehicle_sale_bids')
      .select('*').eq('id', body.award_bid_id).eq('sale_id', params.id).maybeSingle()
    if (!bid) return NextResponse.json({ error: 'Offre introuvable sur ce lot' }, { status: 404 })
    if (!bid.confirmed_at) {
      return NextResponse.json({
        error: "Cette offre n'a jamais été confirmée par son auteur — ne l'attribuez pas sans l'avoir appelé.",
      }, { status: 400 })
    }

    // L'attribution retenue passe en 'awarded', toutes les autres en 'rejected' :
    // on veut pouvoir prévenir les non-retenus sans reconstituer la liste.
    await sb.from('vehicle_sale_bids').update({ status: 'rejected' })
      .eq('sale_id', params.id).neq('id', bid.id)
    await sb.from('vehicle_sale_bids').update({ status: 'awarded' }).eq('id', bid.id)

    patch.awarded_bid_id = bid.id
    patch.sold_price     = bid.amount
    patch.status         = 'awarded'
  }

  if (body.status && STATUSES.includes(body.status)) {
    patch.status = body.status
    if (body.status === 'sold' && !sale.sold_at) patch.sold_at = new Date().toISOString()
  }

  // ── Contrôles avant mise en ligne : mieux vaut refuser que publier un lot creux ──
  if (patch.status === 'published') {
    const merged = { ...sale, ...patch }
    const manque: string[] = []
    if (!merged.title)                                  manque.push('un titre')
    if (!Array.isArray(merged.photos) || !merged.photos.length) manque.push('au moins une photo')
    if (merged.sale_mode === 'fixed' && !merged.price)  manque.push('un prix')
    if (merged.sale_mode !== 'fixed' && !merged.closes_at) manque.push('une date de clôture')
    if (merged.sale_mode === 'auction' && !merged.start_price) manque.push('une mise à prix')
    if (manque.length) {
      return NextResponse.json({ error: `Impossible de publier : il manque ${manque.join(', ')}.` }, { status: 400 })
    }
    if (!merged.opens_at) patch.opens_at = new Date().toISOString()
  }

  const { data, error } = await sb.from('vehicle_sales')
    .update(patch).eq('id', params.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ sale: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const acc = await guard()
  if (!acc) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const sb = createAdminClient()
  const { data: sale } = await sb.from('vehicle_sales').select('status').eq('id', params.id).maybeSingle()
  if (!sale) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })
  if (sale.status !== 'draft') {
    return NextResponse.json({
      error: 'Un lot déjà publié ne se supprime pas — passez-le en « Retiré » pour garder la trace des offres reçues.',
    }, { status: 400 })
  }

  const { error } = await sb.from('vehicle_sales').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

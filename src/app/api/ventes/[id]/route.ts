// src/app/api/ventes/[id]/route.ts
//
// API PUBLIQUE — fiche véhicule et dépôt d'offre.
// GET  /api/ventes/[id]   → un lot en ligne (id ou référence VD-2026-014)
// POST /api/ventes/[id]   → dépose une offre
//
// L'offre n'est comptée qu'une fois confirmée par e-mail (`confirm_token`).
// Sans ça, on récolte des montants fantaisistes de gens qui ne se présentent
// jamais et l'attribution ne veut plus rien dire. Olivier 2026-08-20.

import { NextResponse }      from 'next/server'
import { randomUUID }        from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { sendEmail, emailLayout, button, infoRow } from '@/lib/emails'
import {
  PUBLIC_COLUMNS, publicBidSummary, minimumBid,
  SALE_CONDITIONS, type SaleMode, type BidStatus,
} from '@/lib/ventes/types'

export const dynamic = 'force-dynamic'

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

async function loadPublic(sb: any, key: string) {
  const q = sb.from('vehicle_sales').select(PUBLIC_COLUMNS)
  const { data } = isUuid(key) ? await q.eq('id', key).maybeSingle()
                               : await q.eq('reference', key.toUpperCase()).maybeSingle()
  return data
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const sale = await loadPublic(sb, params.id)
  if (!sale || !['published', 'closed'].includes(sale.status)) {
    return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })
  }

  const { data: bids } = await sb.from('vehicle_sale_bids')
    .select('amount, status').eq('sale_id', sale.id)

  return NextResponse.json({
    sale,
    offers: publicBidSummary(sale.sale_mode as SaleMode, (bids || []) as { amount: number; status: BidStatus }[]),
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const sb = createAdminClient()
  const sale = await loadPublic(sb, params.id)
  if (!sale) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

  if (sale.status !== 'published') {
    return NextResponse.json({ error: 'Ce véhicule n’accepte plus d’offres.' }, { status: 409 })
  }
  if (sale.closes_at && new Date(sale.closes_at) <= new Date()) {
    return NextResponse.json({ error: 'La date de clôture est passée.' }, { status: 409 })
  }

  const amount = Number(body.amount)
  const name   = String(body.name  ?? '').trim().slice(0, 120)
  const email  = String(body.email ?? '').trim().slice(0, 160).toLowerCase()
  const phone  = String(body.phone ?? '').trim().slice(0, 40) || null

  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Montant invalide.' }, { status: 400 })
  if (!name)                                   return NextResponse.json({ error: 'Votre nom est requis.' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Adresse e-mail invalide.' }, { status: 400 })

  const { data: existing } = await sb.from('vehicle_sale_bids')
    .select('amount, status').eq('sale_id', sale.id)
  const live = (existing || []).filter(b => b.status === 'confirmed' || b.status === 'awarded')
  const best = live.length ? Math.max(...live.map(b => Number(b.amount))) : null
  const mini = minimumBid(sale, best)

  if (amount < mini) {
    return NextResponse.json({
      error: sale.sale_mode === 'auction'
        ? `L’offre doit être d’au moins ${mini.toLocaleString('fr-BE')} €.`
        : `Le prix demandé est de ${mini.toLocaleString('fr-BE')} €.`,
    }, { status: 400 })
  }

  const token = randomUUID()
  const { error } = await sb.from('vehicle_sale_bids').insert({
    sale_id:       sale.id,
    amount,
    bidder_name:   name,
    bidder_email:  email,
    bidder_phone:  phone,
    bidder_is_pro: body.is_pro === true,
    bidder_vat:    String(body.vat ?? '').trim().slice(0, 40) || null,
    intent:        ['circulation', 'pieces', 'indecis'].includes(body.intent) ? body.intent : null,
    message:       String(body.message ?? '').trim().slice(0, 1000) || null,
    confirm_token: token,
    status:        'pending',
    ip:            req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent:    req.headers.get('user-agent')?.slice(0, 300) || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
  const link = `${base}/api/ventes/confirm?token=${token}`
  const cond = SALE_CONDITIONS[sale.condition as keyof typeof SALE_CONDITIONS] || sale.condition

  // Si l'e-mail ne part pas, l'offre reste en attente : on ne fait pas échouer
  // le dépôt pour autant, le bureau peut toujours rappeler la personne.
  await sendEmail(
    email,
    `Confirmez votre offre — ${sale.title}`,
    emailLayout(`
      <p>Bonjour ${name},</p>
      <p>Nous avons bien reçu votre offre. <strong>Il reste une étape</strong> : cliquez sur le bouton
      ci-dessous pour la confirmer, sinon elle ne sera pas prise en compte.</p>
      ${infoRow('Véhicule', sale.title)}
      ${infoRow('État', String(cond))}
      ${infoRow('Votre offre', `${amount.toLocaleString('fr-BE')} € TVAC`)}
      ${sale.closes_at ? infoRow('Clôture', new Date(sale.closes_at).toLocaleString('fr-BE')) : ''}
      <p style="margin:24px 0">${button(link, 'Confirmer mon offre')}</p>
      <p>Le véhicule est vendu en l'état, sans garantie. Vous serez prévenu à la clôture,
      que votre offre soit retenue ou non.</p>
      <p>Une question ? 087 35 18 20.</p>
    `, 'Confirmez votre offre'),
    name,
  ).catch(() => {})

  return NextResponse.json({ ok: true, pending: true })
}

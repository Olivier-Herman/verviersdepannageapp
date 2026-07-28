// src/app/api/caisse/ecran/route.ts
//
// Écran client face-comptoir.
//   GET  ?key=…                         → état courant de l'écran (public : la
//                                          tablette kiosque le lit sans login).
//   POST { action:'push', key, … }      → affiche une facture (montant + détail
//                                          + 2 QR SumUp/SEPA), TTL 5 min.
//        { action:'clear', key }         → repos.
//   POST push renvoie { occupied, occupant } si l'écran affiche déjà quelqu'un
//   (sauf force:true) → garde-fou anti-écrasement. Olivier 2026-07-28.

import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { authOptions }         from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase'
import { createCheckout }      from '@/lib/sumup'
import { buildEpcQrPayload, bankConfigFromEnv } from '@/lib/payments/epc-qr'
import { odooRpc }             from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const TTL_MIN = 2
const sumupQrFor = (checkoutUrl: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(checkoutUrl)}`

// Résout le montant TVAC à afficher + le détail des lignes pour une mission,
// à partir de son id. Priorité : facture Odoo détectée → brouillon de lignes
// préparé → CA HTVA figé au to_invoice → tarif spécial → montant à encaisser.
// Renvoie aussi les métas véhicule/client. Olivier 2026-07-28.
async function resolveMissionBilling(sb: any, missionId: string) {
  const { data: m } = await sb.from('incoming_missions')
    .select('mission_number, dossier_number, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, estimated_htva, special_tarif_htva, amount_to_collect, odoo_quote_id, invoice_odoo_id')
    .eq('id', missionId).maybeSingle()
  if (!m) return null

  const meta = {
    client:    m.client_name || null,
    plate:     m.vehicle_plate || null,
    brand:     m.vehicle_brand || null,
    model:     m.vehicle_model || null,
    reference: m.mission_number != null ? String(m.mission_number) : (m.external_id || m.dossier_number || null),
  }
  let amount = 0
  let lines: { label: string; amount: number }[] = []

  // 1) Facture Odoo détectée → montant total (TVAC) + lignes (sous-total HTVA).
  try {
    if (m.odoo_quote_id || m.invoice_odoo_id) {
      const moveIds = new Set<number>()
      if (m.odoo_quote_id) {
        const orders = await odooRpc<any[]>('sale.order', 'read', [[m.odoo_quote_id]], { fields: ['invoice_ids'] })
        for (const id of (orders?.[0]?.invoice_ids || [])) moveIds.add(Number(id))
      }
      if (m.invoice_odoo_id) moveIds.add(Number(m.invoice_odoo_id))
      if (moveIds.size) {
        const moves = await odooRpc<any[]>('account.move', 'read', [[...moveIds]], { fields: ['move_type', 'state', 'amount_total', 'invoice_line_ids'] })
        const kept = (moves || []).filter(x => x.move_type === 'out_invoice' && x.state !== 'cancel')
        const inv = kept[kept.length - 1]
        if (inv && Number(inv.amount_total) > 0) {
          amount = Math.round(Number(inv.amount_total) * 100) / 100
          const lids = (inv.invoice_line_ids || []).map(Number)
          if (lids.length) {
            const rows = await odooRpc<any[]>('account.move.line', 'read', [[...lids]], { fields: ['name', 'price_subtotal', 'display_type'] })
            lines = (rows || [])
              .filter((l: any) => l.display_type !== 'line_section' && l.display_type !== 'line_note')
              .map((l: any) => ({ label: String(l.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s*\n+\s*/g, ' — ').trim(), amount: Math.round(Number(l.price_subtotal || 0) * 100) / 100 }))
          }
        }
      }
    }
  } catch { /* Odoo indispo → on retombe sur le brouillon / le figé */ }

  // 2) Pas de facture → brouillon de lignes préparé dans la modale.
  if (amount <= 0) {
    const { data: draft } = await sb.from('mission_invoice_drafts').select('lines').eq('mission_id', missionId).maybeSingle()
    const dl: any[] = Array.isArray(draft?.lines) ? draft.lines : []
    const htva = dl.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price_unit) || 0), 0)
    if (htva > 0) {
      amount = Math.round(htva * 1.21 * 100) / 100
      lines = dl
        .filter(l => (Number(l.qty) || 0) * (Number(l.price_unit) || 0) !== 0)
        .map(l => ({ label: String(l.name || l.kind || ''), amount: Math.round((Number(l.qty) || 0) * (Number(l.price_unit) || 0) * 1.21 * 100) / 100 }))
    }
  }

  // 3) CA HTVA figé au to_invoice.  4) Tarif spécial.  5) Montant à encaisser (déjà TVAC).
  if (amount <= 0 && Number(m.estimated_htva)     > 0) amount = Math.round(Number(m.estimated_htva)     * 1.21 * 100) / 100
  if (amount <= 0 && Number(m.special_tarif_htva) > 0) amount = Math.round(Number(m.special_tarif_htva) * 1.21 * 100) / 100
  if (amount <= 0 && Number(m.amount_to_collect)  > 0) amount = Math.round(Number(m.amount_to_collect)  * 100) / 100

  return { ...meta, amount, lines }
}

// ── GET : état de l'écran (public) ──────────────────────────────────────────
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || 'facturation'
  const sb = createAdminClient()
  const { data } = await sb.from('customer_display').select('payload, expires_at, label').eq('key', key).maybeSingle()
  const expired = data?.expires_at ? new Date(data.expires_at).getTime() < Date.now() : true
  return NextResponse.json({
    key,
    label:   data?.label || null,
    payload: (data?.payload && !expired) ? data.payload : null,
    expires_at: expired ? null : data?.expires_at || null,
  })
}

// ── POST : push / clear (session requise) ───────────────────────────────────
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role: string = user?.role || ''
  const modules: string[] = user?.modules || []
  const ok = ['admin', 'superadmin'].includes(role)
    || modules.includes('facturation') || modules.includes('encaissement') || modules.includes('encaissements')
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const key = String(body.key || 'facturation')
  const sb = createAdminClient()
  const now = Date.now()

  if (body.action === 'clear') {
    await sb.from('customer_display').upsert(
      { key, payload: null, expires_at: null, updated_at: new Date().toISOString(), updated_by: user.id || null },
      { onConflict: 'key' },
    )
    return NextResponse.json({ ok: true })
  }

  // action = 'push'
  // Card facturation : seul le mission_id est fourni → on résout montant + lignes
  // + métas côté serveur. Modale : amount + lines déjà calculés (prioritaires).
  const resolved = body.mission_id ? await resolveMissionBilling(sb, String(body.mission_id)) : null

  const amount = Math.round((Number(body.amount) > 0 ? Number(body.amount) : Number(resolved?.amount || 0)) * 100) / 100
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Montant à facturer indisponible sur cette fiche.' }, { status: 400 })

  const client = body.client ?? resolved?.client ?? null
  const plate  = body.plate  ?? resolved?.plate  ?? null
  const brand  = body.brand  ?? resolved?.brand  ?? null
  const model  = body.model  ?? resolved?.model  ?? null
  const lines  = (Array.isArray(body.lines) && body.lines.length) ? body.lines : (resolved?.lines || [])

  // Garde-fou : écran déjà occupé (payload non expiré) et pas de force.
  if (!body.force) {
    const { data: cur } = await sb.from('customer_display').select('payload, expires_at').eq('key', key).maybeSingle()
    const active = cur?.payload && cur.expires_at && new Date(cur.expires_at).getTime() > now
    if (active) {
      return NextResponse.json({ occupied: true, occupant: { client: cur!.payload.client, plate: cur!.payload.plate } }, { status: 409 })
    }
  }

  // Référence de paiement (SumUp + virement) = n° de mission + plaque.
  const refBase   = String(body.reference || body.mission_number || resolved?.reference || '').trim()
  const plateRef  = String(plate || '').trim()
  const reference = ([refBase, plateRef].filter(Boolean).join(' ') || 'VD Soft').slice(0, 100)
  const label = [brand, model].filter(Boolean).join(' ')

  // 1) Checkout SumUp (QR carte, montant pré-rempli). Best-effort.
  let sumupQrUrl: string | null = null, sumupCheckoutId: string | null = null
  try {
    const co = await createCheckout({ amount, reference, description: `${label} ${plate || ''}`.trim() || reference })
    if (co?.checkoutUrl) { sumupQrUrl = sumupQrFor(co.checkoutUrl); sumupCheckoutId = co.id || null }
  } catch (e) { /* SumUp indispo → on affiche quand même le virement */ }

  // 2) QR virement SEPA/EPC (montant + communication).
  let epcPayload: string | null = null
  try {
    const bank = bankConfigFromEnv()
    if (bank) epcPayload = buildEpcQrPayload({ name: bank.name, iban: bank.iban, bic: bank.bic, amount, remittance: reference })
  } catch (e) { /* ignore */ }

  const payload = {
    client, plate, brand, model,
    reference,
    amount,                                   // TVAC
    lines,
    sumupQrUrl, sumupCheckoutId, epcPayload,
  }
  const expires_at = new Date(now + TTL_MIN * 60_000).toISOString()
  await sb.from('customer_display').upsert(
    { key, payload, expires_at, updated_at: new Date().toISOString(), updated_by: user.id || null },
    { onConflict: 'key' },
  )
  return NextResponse.json({ ok: true, expires_at })
}

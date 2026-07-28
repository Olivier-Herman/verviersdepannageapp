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

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const TTL_MIN = 2
const sumupQrFor = (checkoutUrl: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(checkoutUrl)}`

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
  const amount = Math.round(Number(body.amount) * 100) / 100
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })

  // Garde-fou : écran déjà occupé (payload non expiré) et pas de force.
  if (!body.force) {
    const { data: cur } = await sb.from('customer_display').select('payload, expires_at').eq('key', key).maybeSingle()
    const active = cur?.payload && cur.expires_at && new Date(cur.expires_at).getTime() > now
    if (active) {
      return NextResponse.json({ occupied: true, occupant: { client: cur!.payload.client, plate: cur!.payload.plate } }, { status: 409 })
    }
  }

  const reference = String(body.reference || body.mission_number || 'VD Soft').slice(0, 100)
  const label = [body.brand, body.model].filter(Boolean).join(' ')

  // 1) Checkout SumUp (QR carte, montant pré-rempli). Best-effort.
  let sumupQrUrl: string | null = null, sumupCheckoutId: string | null = null
  try {
    const co = await createCheckout({ amount, reference, description: `${label} ${body.plate || ''}`.trim() || reference })
    if (co?.checkoutUrl) { sumupQrUrl = sumupQrFor(co.checkoutUrl); sumupCheckoutId = co.id || null }
  } catch (e) { /* SumUp indispo → on affiche quand même le virement */ }

  // 2) QR virement SEPA/EPC (montant + communication).
  let epcPayload: string | null = null
  try {
    const bank = bankConfigFromEnv()
    if (bank) epcPayload = buildEpcQrPayload({ name: bank.name, iban: bank.iban, bic: bank.bic, amount, remittance: reference })
  } catch (e) { /* ignore */ }

  const payload = {
    client:  body.client || null,
    plate:   body.plate || null,
    brand:   body.brand || null,
    model:   body.model || null,
    reference,
    amount,                                   // TVAC
    lines:   Array.isArray(body.lines) ? body.lines : [],
    sumupQrUrl, sumupCheckoutId, epcPayload,
  }
  const expires_at = new Date(now + TTL_MIN * 60_000).toISOString()
  await sb.from('customer_display').upsert(
    { key, payload, expires_at, updated_at: new Date().toISOString(), updated_by: user.id || null },
    { onConflict: 'key' },
  )
  return NextResponse.json({ ok: true, expires_at })
}

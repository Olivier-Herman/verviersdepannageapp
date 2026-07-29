// src/app/api/caisse/push-odoo/route.ts
//
// Affiche une facture Odoo sur l'écran client. Deux entrées :
//   GET  ?move_id=&key=   → lien cliquable (Studio) ouvert dans le navigateur
//                           du facturier déjà loggé → session. Renvoie une page
//                           de confirmation HTML.
//   POST ?secret=&key=    → WEBHOOK Odoo (action serveur « Send Webhook
//                           Notification », SANS Python, compatible SaaS). Auth
//                           par secret (ECRAN_WEBHOOK_SECRET). L'id de la facture
//                           est lu dans le corps JSON envoyé par Odoo.
//
// Dans les 2 cas : lit account.move (total TVAC, partenaire, lignes, n°) +
// véhicule de la fiche VD Soft liée → pousse sur l'écran (montant + détail + nom
// + 2 QR SumUp/SEPA, communication virement = n° de facture). Olivier 2026-07-29.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function html(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Écran client</title><style>
     body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f8fafc;color:#0b1120;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
     .card{background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:32px 40px;text-align:center;box-shadow:0 12px 40px rgba(15,23,42,.08);max-width:90vw}
     .big{font-size:44px;margin-bottom:8px}.t{font-size:20px;font-weight:800}.s{color:#64748b;margin-top:6px;font-size:14px}
     .err{color:#b91c1c}</style></head><body><div class="card">${body}</div>
     <script>setTimeout(function(){try{window.close()}catch(e){}},2500)</script></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

// Cœur commun : lit la facture Odoo + la fiche liée, pousse sur l'écran.
// Retourne { ok, error?, info } pour que l'appelant formate sa réponse.
async function pushInvoice(moveId: number, key: string): Promise<{ ok: boolean; error?: string; info?: string }> {
  if (!moveId) return { ok: false, error: 'move_id manquant' }

  let inv: any = null, lines: { label: string; amount: number }[] = [], partner = ''
  try {
    const moves = await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['name', 'amount_total', 'amount_residual', 'partner_id', 'invoice_line_ids', 'move_type', 'state'] })
    inv = moves?.[0]
    if (!inv) return { ok: false, error: 'Facture Odoo introuvable' }
    partner = Array.isArray(inv.partner_id) ? String(inv.partner_id[1] || '') : ''
    const lids = (inv.invoice_line_ids || []).map(Number)
    if (lids.length) {
      const rows = await odooRpc<any[]>('account.move.line', 'read', [lids], { fields: ['name', 'price_subtotal', 'display_type'] })
      lines = (rows || [])
        .filter((l: any) => l.display_type !== 'line_section' && l.display_type !== 'line_note')
        .map((l: any) => ({ label: String(l.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s*\n+\s*/g, ' — ').trim(), amount: Math.round(Number(l.price_subtotal || 0) * 100) / 100 }))
    }
  } catch (e: any) {
    return { ok: false, error: `Lecture Odoo impossible : ${String(e?.message || e).slice(0, 120)}` }
  }

  // Total TVAC + solde dû. Sur facture VALIDÉE (posted), amount_residual tient
  // compte des paiements déjà enregistrés (ex. acompte espèces) → c'est LUI le
  // montant à afficher en grand + celui du QR. Le total reste affiché en petit.
  const total    = Math.round(Number(inv.amount_total || 0) * 100) / 100
  const residual = Math.round(Number(inv.amount_residual || 0) * 100) / 100
  const posted   = inv.state === 'posted'
  let amount = total                               // brouillon : rien encaissé → dû = total
  let amountTotal: number | undefined              // affiché en petit UNIQUEMENT si paiement partiel
  if (posted) {
    if (residual <= 0) return { ok: false, error: 'Facture déjà soldée (rien à payer)' }
    amount = residual
    if (residual < total - 0.005) amountTotal = total
  }
  if (!amount || amount <= 0) return { ok: false, error: 'Montant nul sur la facture' }

  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('vehicle_plate, vehicle_brand, vehicle_model, client_name')
    .eq('invoice_odoo_id', moveId).maybeSingle()

  const base = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  const r = await fetch(`${base}/api/caisse/ecran`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
    body: JSON.stringify({
      action: 'push', key, force: true,
      amount,                                       // solde dû → QR SumUp + SEPA
      amountTotal,                                  // total TVAC (petit) si partiel
      client: partner || m?.client_name || null,
      plate:  m?.vehicle_plate || null,
      brand:  m?.vehicle_brand || null,
      model:  m?.vehicle_model || null,
      lines,
      paymentRef: inv.name && inv.name !== '/' ? inv.name : undefined,   // communication = n° facture
    }),
  })
  if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, error: j.error || `Écran client KO (HTTP ${r.status})` } }

  const veh = [m?.vehicle_brand, m?.vehicle_model].filter(Boolean).join(' ')
  const info = `${partner || m?.client_name || ''}${veh ? ' · ' + veh : ''}${m?.vehicle_plate ? ' · ' + m.vehicle_plate : ''} · ${amount.toFixed(2).replace('.', ',')} € · facture ${inv.name || ''}`
  return { ok: true, info }
}

// Extrait l'id de facture d'un payload webhook Odoo (formats variés selon version).
function extractMoveId(body: any, url: URL): number {
  const q = Number(url.searchParams.get('move_id'))
  if (q) return q
  const cand = body?._id ?? body?.id ?? body?.res_id ?? body?.move_id
    ?? (Array.isArray(body?._ids) ? body._ids[0] : undefined)
    ?? (Array.isArray(body?.ids) ? body.ids[0] : undefined)
    ?? (Array.isArray(body?.records) ? body.records[0]?.id : undefined)
  return Number(cand) || 0
}

// ── GET : lien navigateur (session) ─────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role: string = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  const ok = ['admin', 'superadmin'].includes(role) || modules.includes('facturation') || modules.includes('encaissement') || modules.includes('encaissements')
  if (!ok) return html('<div class="big">🔒</div><div class="t">Connecte-toi à VD Soft</div><div class="s">Ouvre app.verviersdepannage.com (module facturation) dans ce navigateur, puis reclique.</div>', 401)

  const url = new URL(req.url)
  const key = String(url.searchParams.get('key') || 'facturation')
  const res = await pushInvoice(Number(url.searchParams.get('move_id')), key)
  if (!res.ok) return html(`<div class="big">⚠️</div><div class="t err">${res.error}</div>`)
  return html(`<div class="big">📺✅</div><div class="t">Affiché à l'écran client</div><div class="s">${res.info || ''}</div>`)
}

// ── POST : webhook Odoo (secret) ────────────────────────────────────────────
export async function POST(req: Request) {
  const url = new URL(req.url)
  const expected = process.env.ECRAN_WEBHOOK_SECRET
  const given = url.searchParams.get('secret') || req.headers.get('x-webhook-secret') || ''
  if (!expected || given !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const key = String(url.searchParams.get('key') || 'facturation')
  const moveId = extractMoveId(body, url)
  const res = await pushInvoice(moveId, key)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}

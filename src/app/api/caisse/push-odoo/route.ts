// src/app/api/caisse/push-odoo/route.ts
//
// GET ?move_id=<id facture Odoo>&key=<écran>
//   Déclenché par un bouton « 📺 Afficher au client » DANS une facture Odoo
//   (action serveur type act_url ouvrant cette URL dans le navigateur du
//   facturier, déjà loggé sur VD Soft). Lit la facture Odoo (account.move :
//   total TVAC, partenaire, lignes, n°), complète avec le véhicule de la fiche
//   VD Soft liée, et POUSSE sur l'écran client (même mécanisme que le bouton
//   habituel : montant + détail + nom + 2 QR SumUp/SEPA). Renvoie une page de
//   confirmation. Olivier 2026-07-29.
//
// Accès : session (module facturation/encaissement) — l'onglet s'ouvre dans le
// navigateur déjà authentifié.

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

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role: string = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  const ok = ['admin', 'superadmin'].includes(role) || modules.includes('facturation') || modules.includes('encaissement') || modules.includes('encaissements')
  if (!ok) return html('<div class="big">🔒</div><div class="t">Connecte-toi à VD Soft</div><div class="s">Ouvre app.verviersdepannage.com (module facturation) dans ce navigateur, puis reclique le bouton.</div>', 401)

  const url = new URL(req.url)
  const moveId = Number(url.searchParams.get('move_id'))
  const key = String(url.searchParams.get('key') || 'facturation')
  if (!moveId) return html('<div class="big">⚠️</div><div class="t err">move_id manquant</div>')

  // 1) Facture Odoo.
  let inv: any = null, lines: { label: string; amount: number }[] = [], partner = ''
  try {
    const moves = await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['name', 'amount_total', 'partner_id', 'invoice_line_ids', 'move_type', 'state'] })
    inv = moves?.[0]
    if (!inv) return html('<div class="big">⚠️</div><div class="t err">Facture Odoo introuvable</div>')
    partner = Array.isArray(inv.partner_id) ? String(inv.partner_id[1] || '') : ''
    const lids = (inv.invoice_line_ids || []).map(Number)
    if (lids.length) {
      const rows = await odooRpc<any[]>('account.move.line', 'read', [lids], { fields: ['name', 'price_subtotal', 'display_type'] })
      lines = (rows || [])
        .filter((l: any) => l.display_type !== 'line_section' && l.display_type !== 'line_note')
        .map((l: any) => ({ label: String(l.name || '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s*\n+\s*/g, ' — ').trim(), amount: Math.round(Number(l.price_subtotal || 0) * 100) / 100 }))
    }
  } catch (e: any) {
    return html(`<div class="big">⚠️</div><div class="t err">Lecture Odoo impossible</div><div class="s">${String(e?.message || e).slice(0, 120)}</div>`)
  }

  const amount = Math.round(Number(inv.amount_total || 0) * 100) / 100
  if (!amount || amount <= 0) return html('<div class="big">⚠️</div><div class="t err">Montant nul sur la facture</div>')

  // 2) Véhicule depuis notre fiche liée (par invoice_odoo_id).
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('vehicle_plate, vehicle_brand, vehicle_model, client_name, mission_number')
    .eq('invoice_odoo_id', moveId).maybeSingle()

  // 3) Push sur l'écran client (réutilise SumUp + SEPA + realtime).
  const base = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  try {
    const r = await fetch(`${base}/api/caisse/ecran`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify({
        action: 'push', key, force: true,
        amount,
        client: partner || m?.client_name || null,
        plate:  m?.vehicle_plate || null,
        brand:  m?.vehicle_brand || null,
        model:  m?.vehicle_model || null,
        lines,
        paymentRef: inv.name && inv.name !== '/' ? inv.name : undefined,  // n° facture = communication virement
      }),
    })
    if (!r.ok) { const j = await r.json().catch(() => ({})); return html(`<div class="big">⚠️</div><div class="t err">Écran client KO</div><div class="s">${j.error || ('HTTP ' + r.status)}</div>`) }
  } catch (e: any) {
    return html(`<div class="big">⚠️</div><div class="t err">Envoi écran KO</div><div class="s">${String(e?.message || e).slice(0, 120)}</div>`)
  }

  const veh = [m?.vehicle_brand, m?.vehicle_model].filter(Boolean).join(' ')
  return html(`<div class="big">📺✅</div><div class="t">Affiché à l'écran client</div>
    <div class="s">${partner || m?.client_name || ''}${veh ? ' · ' + veh : ''}${m?.vehicle_plate ? ' · ' + m.vehicle_plate : ''}<br><b>${amount.toFixed(2).replace('.', ',')} €</b> · facture ${inv.name || ''}</div>`)
}

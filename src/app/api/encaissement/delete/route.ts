// POST /api/encaissement/delete   Body : { id: string; reason: string }
//
// Supprime un encaissement (ligne interventions service_type='encaissement')
// qu'un chauffeur a encodé par erreur, en DÉFAISANT ses effets de bord :
//   1. Annule le devis Odoo lié (orphelin synchronisé), si encore draft/sent.
//   2. Retire la ligne caisse (espèces) → corrige le solde du chauffeur.
//   3. Supprime la ligne intervention.
//   4. Recalcule payment_amount de la mission liée (et vide le paiement si 0).
//   5. Trace dans activity_logs (qui, quoi, pourquoi).
//
// Réservé superadmin (mouvement d'argent). Olivier 2026-08-19.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpcAs }         from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration  = 30

const MIN_REASON = 4

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const actor = session.user as any
  if (actor.role !== 'superadmin') {
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  }

  const body   = await req.json().catch(() => ({}))
  const id     = String(body.id || '').trim()
  const reason = String(body.reason || '').trim()
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  if (reason.length < MIN_REASON) {
    return NextResponse.json({ error: `Motif obligatoire (min ${MIN_REASON} caractères)` }, { status: 400 })
  }

  const sb = createAdminClient()

  // 1. Charger l'encaissement
  const { data: iv } = await sb.from('interventions')
    .select('id, reference, service_type, amount, payment_mode, driver_id, mission_id, odoo_invoice_id, synced_to_odoo, client_name, plate, payment_reference')
    .eq('id', id).maybeSingle()
  if (!iv) return NextResponse.json({ error: 'Encaissement introuvable' }, { status: 404 })
  if (iv.service_type !== 'encaissement') {
    return NextResponse.json({ error: 'Cette ligne n\'est pas un encaissement.' }, { status: 400 })
  }

  const reversed: string[] = []
  const warnings: string[] = []

  // 2. Annuler le devis Odoo lié (uniquement s'il est encore modifiable)
  if (iv.odoo_invoice_id) {
    try {
      const orders = await odooRpcAs<any[]>(actor.id, 'sale.order', 'read',
        [[iv.odoo_invoice_id]], { fields: ['id', 'name', 'state'] })
      const order = orders?.[0]
      if (order) {
        if (['draft', 'sent'].includes(order.state)) {
          await odooRpcAs(actor.id, 'sale.order', 'action_cancel', [[iv.odoo_invoice_id]])
          try {
            await odooRpcAs(actor.id, 'sale.order', 'message_post', [[iv.odoo_invoice_id]],
              { body: `Devis annulé — encaissement supprimé (erreur d'encodage). Motif : ${reason}` })
          } catch { /* note best-effort */ }
          reversed.push(`Devis Odoo ${order.name} annulé`)
        } else {
          warnings.push(`Le devis Odoo ${order.name} est déjà confirmé (${order.state}) — non annulé, à traiter dans Odoo.`)
        }
      }
    } catch (e: any) {
      warnings.push(`Annulation du devis Odoo impossible : ${e?.message || 'erreur'} — à vérifier dans Odoo.`)
    }
  }

  // 3. Retirer l'entrée caisse (espèces) → corrige le solde du chauffeur
  const { data: cashRows } = await sb.from('cash_register')
    .select('id, amount, type').eq('intervention_id', id)
  if (cashRows && cashRows.length) {
    await sb.from('cash_register').delete().eq('intervention_id', id)
    const net = cashRows.reduce((s, r) =>
      s + (r.type === 'remise' ? -Number(r.amount || 0) : Number(r.amount || 0)), 0)
    reversed.push(`Caisse chauffeur corrigée (−${net.toFixed(2)} €)`)
  }

  // 4. Supprimer la ligne intervention
  const { error: delErr } = await sb.from('interventions').delete().eq('id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  reversed.push(`Encaissement ${iv.reference} supprimé`)

  // 5. Recalculer le paiement de la mission liée
  if (iv.mission_id) {
    const { data: rest } = await sb.from('interventions')
      .select('amount').eq('mission_id', iv.mission_id)
    const sum = (rest || []).reduce((s, p) => s + Number(p.amount || 0), 0)
    const upd: Record<string, any> = { payment_amount: sum }
    if (sum <= 0) { upd.payment_collected_at = null; upd.payment_mode = null }
    await sb.from('incoming_missions').update(upd).eq('id', iv.mission_id)
    reversed.push(`Mission recalculée (payé = ${sum.toFixed(2)} €)`)
    warnings.push('Statut de la mission inchangé : si cet encaissement avait déclenché une restitution ou une finalisation auto, vérifiez la fiche.')
  }

  // 6. Paiement carte non remboursé par une suppression en base
  if (iv.payment_mode && !['cash', 'unpaid'].includes(iv.payment_mode)) {
    warnings.push(`Paiement « ${iv.payment_mode} » : la suppression ne rembourse pas le client (à gérer côté SumUp/banque si nécessaire).`)
  }

  // 7. Traçabilité
  try {
    await sb.from('activity_logs').insert({
      user_id:     actor.id,
      action:      'encaissement_deleted',
      entity_type: 'interventions',
      entity_id:   id,
      details: {
        reference: iv.reference, amount: iv.amount, payment_mode: iv.payment_mode,
        driver_id: iv.driver_id, mission_id: iv.mission_id,
        odoo_invoice_id: iv.odoo_invoice_id, reason, reversed, warnings,
      },
    })
  } catch (e: any) {
    console.error('[encaissement/delete] activity_logs:', e?.message)
  }

  return NextResponse.json({ ok: true, reversed, warnings })
}

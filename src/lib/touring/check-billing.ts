// src/lib/touring/check-billing.ts
//
// Helpers de facturation partagés par le rapprochement auto (accord) et le
// moteur d'application des réponses Touring (Check Touring). Reproduisent les
// effets des routes /api/missions/invoice et /no-charge, appelables côté serveur.

import { releaseParcAndShift } from '@/lib/parc/release'

const BASE_URL = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'

/** Passe une mission (to_invoice) en « Facturation OK » avec un n° de facture libre. */
export async function markInvoicedOK(
  sb: any, missionId: string, invoiceNumber: string, actorId: string | null,
): Promise<{ ok: boolean; skipped?: string }> {
  const { data: m } = await sb.from('incoming_missions')
    .select('id, status').eq('id', missionId).maybeSingle()
  if (!m) return { ok: false, skipped: 'introuvable' }
  if (m.status !== 'to_invoice') return { ok: false, skipped: `statut ${m.status}` }

  const now = new Date().toISOString()
  const { error } = await sb.from('incoming_missions').update({
    status:          'completed',
    invoice_method:  'manual',
    invoice_number:  invoiceNumber,
    invoice_odoo_id: null,
    invoice_url:     null,
    invoiced_at:     now,
    invoiced_by:     actorId,
    touring_check_stamp: null,
  }).eq('id', missionId)
  if (error) return { ok: false, skipped: error.message }

  try { await releaseParcAndShift(sb, missionId) } catch { /* non bloquant */ }
  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: actorId, action: 'invoiced',
    notes: `Facturée n° ${invoiceNumber}`, metadata: { method: 'manual', invoice_number: invoiceNumber, source: 'touring_check' },
  }).then(() => {}, () => {})
  return { ok: true }
}

/** Annule une mission (to_invoice) sans frais, avec motif. */
export async function markNoCharge(
  sb: any, missionId: string, reason: string, actorId: string | null,
): Promise<{ ok: boolean; skipped?: string }> {
  const { data: m } = await sb.from('incoming_missions')
    .select('id, status').eq('id', missionId).maybeSingle()
  if (!m) return { ok: false, skipped: 'introuvable' }
  if (m.status !== 'to_invoice') return { ok: false, skipped: `statut ${m.status}` }

  const now = new Date().toISOString()
  const { error } = await sb.from('incoming_missions').update({
    status:           'completed',
    no_charge_at:     now,
    no_charge_reason: reason,
    no_charge_by:     actorId,
    invoice_method:   null,
    invoice_number:   null,
    invoice_odoo_id:  null,
    invoice_url:      null,
    touring_check_stamp: null,
  }).eq('id', missionId)
  if (error) return { ok: false, skipped: error.message }

  try { await releaseParcAndShift(sb, missionId) } catch { /* non bloquant */ }
  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: actorId, action: 'no_charge',
    notes: `Sans frais — ${reason}`, metadata: { reason, source: 'touring_check' },
  }).then(() => {}, () => {})
  return { ok: true }
}

/** Pose (ou retire avec null) un tampon Check Touring sur des missions. */
export async function stampMissions(sb: any, missionIds: string[], stamp: string | null): Promise<void> {
  if (!missionIds.length) return
  await sb.from('incoming_missions').update({ touring_check_stamp: stamp }).in('id', missionIds)
}

/** Lance l'auto-facturation Odoo d'une mission (draft account.move + auto_invoiced). */
export async function autoInvoiceMission(missionId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${BASE_URL}/api/missions/${missionId}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify({ mode: 'invoice', requireTariff: true }),
    })
    const j = await r.json().catch(() => ({}))
    if (j?.ok && j.invoice) return { ok: true }
    return { ok: false, reason: j?.reason || j?.error || `HTTP ${r.status}` }
  } catch (e: any) {
    return { ok: false, reason: `fetch: ${String(e?.message || e)}` }
  }
}

/** Ajoute une remarque de facturation (pour « Autre → à vérifier »). */
export async function addBillingRemark(sb: any, missionId: string, text: string, actorId: string | null): Promise<void> {
  await sb.from('mission_billing_remarks').insert({ mission_id: missionId, text, created_by: actorId }).then(() => {}, () => {})
}

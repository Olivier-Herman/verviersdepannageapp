// src/lib/restitution/officer-copy.ts
//
// Mal garée : copie de la facture ACQUITTÉE au policier renseigné sur la fiche
// (Olivier 28/09/2026 : « pour tout ce qui est mal garée, on peut envoyer une
// copie de la facture acquittée au policier s'il est précisé dans la fiche »).
// Même canal que les relances réquisitoire : contact Odoo du policier
// (officer_partner_id → e-mail), envoi depuis la boîte fourrière. Une seule
// fois par facture (journal « officer_invoice_copy »). Appelé à la sortie après
// paiement vérifié, et par la synchro des paiements (facture payée plus tard).

import { createAdminClient } from '@/lib/supabase'
import { sendEmail, emailLayout } from '@/lib/emails'
import { getOfficerEmail, FOURRIERE_FROM } from '@/lib/requisitoire/relance'
import { fetchInvoicePdfFromOdoo } from '@/lib/relances/odoo'

const norm = (x: string) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Contact Odoo du policier d'après son nom (tous les mots de ≥ 3 lettres doivent y être), départagé par la zone. */
async function findOfficerPartner(name: string, zone?: string | null): Promise<number | null> {
  const tokens = norm(name).split(' ').filter(t => t.length > 2)
  if (!tokens.length) return null
  const { odooRpc } = await import('@/lib/odoo')
  const cops = await odooRpc<any[]>('res.partner', 'search_read', [[['parent_id.name', 'ilike', 'police zone'], ['email', '!=', false]]], { fields: ['id', 'name', 'parent_id'], limit: 3000 }).catch(() => [] as any[])
  let hits = cops.filter(c => tokens.every(t => norm(c.name).split(' ').includes(t)))
  if (hits.length > 1 && zone) {
    const zw = norm(zone).split(' ').filter(w => w.length > 3 && !['police', 'zone'].includes(w))
    const inZone = hits.filter(h => zw.some(w => norm(h.parent_id?.[1] || '').includes(w)))
    if (inZone.length) hits = inZone
  }
  return hits.length === 1 ? hits[0].id : null
}

const fmtD = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

export async function sendPaidInvoiceToOfficer(missionId: string, invoiceId: number, invoiceName: string): Promise<{ sent: boolean; reason?: string }> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, source, vehicle_plate, vehicle_brand, vehicle_model, incident_address, intervention_date, received_at, officer_name, officer_partner_id, police_zone, parent_mission_id, dossier_leg')
    .eq('id', missionId).maybeSingle()
  if (!m) return { sent: false, reason: 'fiche introuvable' }
  // Un volet de gardiennage renvoie à sa fiche principale.
  let root: any = m
  if (m.dossier_leg && m.parent_mission_id) {
    const { data: r } = await sb.from('incoming_missions').select('id, mission_number, source, vehicle_plate, vehicle_brand, vehicle_model, incident_address, intervention_date, received_at, officer_name, officer_partner_id, police_zone').eq('id', m.parent_mission_id).maybeSingle()
    if (r) root = r
  }
  if (root.source !== 'police_mg') return { sent: false, reason: 'pas une mal garée' }
  const { data: done } = await sb.from('mission_logs').select('id').eq('mission_id', root.id).eq('action', 'officer_invoice_copy').contains('metadata', { invoice_odoo_id: invoiceId }).limit(1)
  if (done?.length) return { sent: false, reason: 'déjà envoyée' }
  // Policier tapé en toutes lettres sans contact lié (cas courant) : on le
  // retrouve parmi les contacts des zones de police d'Odoo et on le relie.
  if (!root.officer_partner_id && root.officer_name) {
    const pid = await findOfficerPartner(String(root.officer_name), root.police_zone)
    if (pid) { root.officer_partner_id = pid; await sb.from('incoming_missions').update({ officer_partner_id: pid }).eq('id', root.id).then(() => {}, () => {}) }
  }
  const officer = await getOfficerEmail(root.officer_partner_id)
  if (!officer) {
    if (root.officer_partner_id || root.officer_name) {
      await sb.from('mission_logs').insert({ mission_id: root.id, action: 'officer_invoice_copy_skipped', notes: `Facture ${invoiceName} acquittée : copie non envoyée au policier${root.officer_name ? ` (${root.officer_name})` : ''}, e-mail inconnu — compléter son contact.`, metadata: { invoice_odoo_id: invoiceId } }).then(() => {}, () => {})
    }
    return { sent: false, reason: 'policier sans e-mail' }
  }
  const pdf = await fetchInvoicePdfFromOdoo(invoiceId)
  const vehicle = [root.vehicle_brand, root.vehicle_model].filter(Boolean).join(' ')
  const html = emailLayout(`
    <p style="margin:0 0 16px;font-size:15px;color:#222;">Bonjour${officer.name ? ' ' + officer.name : ''},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6;">
      Le véhicule <b>${root.vehicle_plate || '—'}</b>${vehicle ? ` (${vehicle})` : ''}, enlevé le ${fmtD(root.intervention_date || root.received_at)}${root.incident_address ? ` (${root.incident_address})` : ''} à votre demande, a été restitué.
      Vous trouverez ci-joint la facture acquittée n° <b>${invoiceName}</b>.
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#888;">Bien à vous,<br>Le service Fourrière — Verviers Dépannage</p>
  `, `Facture acquittée ${invoiceName}`)
  await sendEmail(officer.email, `Véhicule ${root.vehicle_plate || ''} restitué — facture acquittée ${invoiceName}`, html, officer.name, undefined,
    [{ name: `${invoiceName.replace(/\//g, '-')}.pdf`, contentType: 'application/pdf', contentBytes: pdf.toString('base64') }], FOURRIERE_FROM)
  await sb.from('mission_logs').insert({ mission_id: root.id, action: 'officer_invoice_copy', notes: `Copie de la facture acquittée ${invoiceName} envoyée au policier ${officer.name || ''} (${officer.email}).`, metadata: { invoice_odoo_id: invoiceId, email: officer.email } }).then(() => {}, () => {})
  return { sent: true }
}

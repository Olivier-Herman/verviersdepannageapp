// src/lib/fines/odoo-bill.ts
//
// Crée directement la FACTURE FOURNISSEUR Odoo (account.move, in_invoice) pour
// une amende, en BROUILLON, avec le scan du PV en pièce jointe. Olivier valide
// lui-même dans Odoo (compta). Module facturation → on ne renseigne PAS le compte
// de charge (Odoo le dérivera à la validation).
//
// Fournisseur = Police Fédérale (partner 79) · Journal = Achats/BILL (id 8).
// Libellé de ligne = LIBRE : date · lieu · plaque · chauffeur.
//
// Olivier 2026-07-01. Cf [[project_amendes_odoo_facture_fournisseur]].

import { odooRpc } from '@/lib/odoo'

const FINE_ODOO_PARTNER_ID = 79   // Police Fédérale
const FINE_ODOO_JOURNAL_ID = 8    // Journal « Achats » (préfixe BILL)

function fmtDateBE(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' })
}

// YYYY-MM-DD (heure locale BE) pour la date de facturation Odoo.
function dateOnlyBE(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export async function createFineVendorBill(
  sb: any,
  fineId: string,
): Promise<{ ok: true; move_id: number; move_name: string | null; status: string } | { ok: false; error: string }> {
  const { data: f, error } = await sb
    .from('fines')
    .select(`id, plate, amount, infraction_date, infraction_place, infraction_ref, identification_code,
             photo_url, odoo_move_id, status, driver:users!fines_driver_id_fkey(name)`)
    .eq('id', fineId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!f)    return { ok: false, error: 'Amende introuvable' }
  if (f.amount == null || Number(f.amount) <= 0) return { ok: false, error: 'Montant manquant : renseigne-le avant d’envoyer aux achats.' }
  if (f.odoo_move_id)  return { ok: false, error: 'Facture Odoo déjà créée pour cette amende.' }

  // Libellé libre : Amende — date · lieu · plaque · chauffeur
  const driverName = (f.driver as any)?.name || null
  const libelle = 'Amende — ' + [fmtDateBE(f.infraction_date), f.infraction_place, f.plate, driverName]
    .map(v => (v || '').toString().trim()).filter(Boolean).join(' · ')

  let moveId: number
  try {
    moveId = await odooRpc<number>('account.move', 'create', [{
      move_type:  'in_invoice',
      partner_id: FINE_ODOO_PARTNER_ID,
      journal_id: FINE_ODOO_JOURNAL_ID,
      invoice_date: dateOnlyBE(f.infraction_date),   // date de facturation = date de l'infraction
      ref:        f.infraction_ref || f.identification_code || null,
      invoice_line_ids: [[0, 0, {
        name:       libelle,
        quantity:   1,
        price_unit: Number(f.amount),
        tax_ids:    [[6, 0, []]],   // pas de TVA sur une amende
      }]],
    }])
  } catch (e: any) {
    return { ok: false, error: `Création facture Odoo : ${e?.message || 'échec'}` }
  }

  // Pièce jointe : le scan du PV (téléchargé depuis le storage via son URL signée).
  try {
    const res = await fetch(f.photo_url)
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      const ctype = res.headers.get('content-type') || (f.photo_url.toLowerCase().includes('.pdf') ? 'application/pdf' : 'image/jpeg')
      const ext = ctype.includes('pdf') ? 'pdf' : (ctype.includes('png') ? 'png' : 'jpg')
      const attId = await odooRpc<number>('ir.attachment', 'create', [{
        name:      `PV-${f.infraction_ref || f.id}.${ext}`,
        type:      'binary',
        datas:     buf.toString('base64'),
        res_model: 'account.move',
        res_id:    moveId,
        mimetype:  ctype,
      }])
      await odooRpc('account.move', 'message_post', [[moveId]], {
        body: 'Scan du PV', message_type: 'comment', subtype_id: 2, attachment_ids: [[4, attId]],
      }).catch(() => {})
    }
  } catch { /* PJ best-effort */ }

  // Lire le numéro + statut (brouillon = name '/').
  let moveName: string | null = null
  let state = 'draft'
  try {
    const rows = await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['name', 'state', 'payment_state'] })
    const m = rows?.[0]
    if (m) { moveName = m.name && m.name !== '/' ? m.name : null; state = m.state || 'draft' }
  } catch { /* ignore */ }

  await sb.from('fines').update({
    odoo_move_id:     moveId,
    odoo_move_name:   moveName,
    odoo_move_status: state,
    status:           'sent_to_purchase',
    purchase_email_sent: true,
    purchase_email_sent_at: new Date().toISOString(),
  }).eq('id', fineId)

  return { ok: true, move_id: moveId, move_name: moveName, status: state }
}

/** Rafraîchit le n° + statut de la facture Odoo liée. */
export async function refreshFineOdooStatus(
  sb: any,
  fineId: string,
): Promise<{ ok: true; move_name: string | null; status: string } | { ok: false; error: string }> {
  const { data: f } = await sb.from('fines').select('id, odoo_move_id').eq('id', fineId).maybeSingle()
  if (!f?.odoo_move_id) return { ok: false, error: 'Aucune facture Odoo liée.' }
  try {
    const rows = await odooRpc<any[]>('account.move', 'read', [[f.odoo_move_id]], { fields: ['name', 'state', 'payment_state'] })
    const m = rows?.[0]
    if (!m) return { ok: false, error: 'Facture Odoo introuvable (supprimée ?).' }
    const moveName = m.name && m.name !== '/' ? m.name : null
    const status = m.state === 'posted' && m.payment_state === 'paid' ? 'posted·payé' : (m.state || 'draft')
    await sb.from('fines').update({ odoo_move_name: moveName, odoo_move_status: status }).eq('id', fineId)
    return { ok: true, move_name: moveName, status }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'échec' }
  }
}

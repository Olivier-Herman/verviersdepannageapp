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

const lev = (a: string, b: string): number => {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
/** Un mot tapé « ressemble » à un mot du contact : identique, une faute (deux si mot long), ou abrégé (Greg → Gregory). */
const close = (t: string, c: string) => t === c || (t.length >= 4 && c.startsWith(t)) || lev(t, c) <= (t.length >= 7 ? 2 : 1)

/** Contact Odoo du policier d'après son nom tapé sur la fiche (Olivier 28/09 : « vérifie si on a quelque
 *  chose qui ressemble dans Odoo »). Exact d'abord, puis approché ; départagé par la zone ; jamais de choix
 *  quand deux policiers conviennent. */
export async function findOfficerPartner(name: string, zone?: string | null): Promise<number | null> {
  // Les grades et mentions ne sont pas des noms (« Lieutenant », « Inspecteur », « OPJ »).
  // « lieutenant » n'y est pas : Roger Lieutenant (ZP Fagnes) existe (Olivier 28/09/2026).
  const RANKS = new Set(['commissaire', 'inspecteur', 'inspectrice', 'agent', 'opj', 'brigadier', 'chef', 'principal', 'police', 'zone'])
  const tokens = norm(String(name).replace(/\(.*?\)/g, ' ')).split(' ').filter(t => t.length > 2 && !RANKS.has(t))
  if (!tokens.length) return null
  const { odooRpc } = await import('@/lib/odoo')
  const cops = await odooRpc<any[]>('res.partner', 'search_read', [['|', ['parent_id.name', 'ilike', 'police'], ['email', 'ilike', 'police.belgium'], ['email', '!=', false]]], { fields: ['id', 'name', 'parent_id'], limit: 5000 }).catch(() => [] as any[])
  const words = (c: any) => norm(String(c.name || '').replace(/\(.*?\)/g, ' ')).split(' ').filter(Boolean)
  // Jamais une adresse qui n'est pas une personne (listes, « no reply », boîtes de service).
  const people = cops.filter(c => !/@|no ?reply|^list|dispatch|fourriere|police f[ée]d[ée]rale|^police|^wpr|^dac/i.test(String(c.name || '')))
  // Un seul mot tapé (souvent le nom de famille) : exact et UNIQUE parmi tous les policiers,
  // sans tolérance ni départage par la zone — un prénom ou un grade seul ne suffit pas.
  if (tokens.length === 1) {
    const hits = people.filter(c => words(c).includes(tokens[0]))
    const uniq = Array.from(new Map(hits.map(h => [words(h).sort().join(' '), h])).values())
    if (uniq.length !== 1) return null
    // Et de la zone de la fiche quand on la connaît.
    const zw = zone ? norm(zone).split(' ').filter(w => w.length > 3 && !['police', 'zone'].includes(w)) : []
    if (zw.length && !zw.some(w => norm((uniq[0] as any).parent_id?.[1] || '').includes(w) || norm((uniq[0] as any).name || '').includes(w))) return null
    return (uniq[0] as any).id
  }
  const pick = (hits: any[]) => {
    if (hits.length > 1 && zone) {
      const zw = norm(zone).split(' ').filter(w => w.length > 3 && !['police', 'zone'].includes(w))
      const inZone = hits.filter(h => zw.some(w => norm(h.parent_id?.[1] || '').includes(w)))
      if (inZone.length) hits = inZone
    }
    // Même personne encodée deux fois (« Jottard Adrien » et « Jottard Adrien (ZP Vesdre) ») : on garde la plus ancienne.
    const uniq = Array.from(new Map(hits.map(h => [words(h).sort().join(' '), h])).values())
    return uniq.length === 1 ? uniq.sort((x: any, y: any) => x.id - y.id)[0].id as number : null
  }
  const exact = people.filter(c => tokens.every(t => words(c).includes(t)))
  if (exact.length) return pick(exact)
  return pick(people.filter(c => tokens.every(t => words(c).some(w => close(t, w)))))
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

// src/lib/facturation/peppol-envoi.ts — un client belge inscrit sur Peppol reçoit ses factures par Peppol seul (Olivier 19/11/2026).
// Seulement avec un n° de TVA belge (celui de la société, l'adresse de facturation en hérite) : sinon on garde le mail.
//
// Le réglage « Envoi des factures » de la fiche client (res.partner.invoice_sending_method, propre à chaque société)
// décide des cases cochées par défaut quand on envoie une facture depuis l'ERP. Vide ou « par e-mail » : le mail est
// coché, et le client reçoit la facture en double (Allianz les refusait). Chaque nuit, toute fiche inscrite sur Peppol
// encore réglée « par e-mail » ou sans réglage passe en « par Peppol ». « Par courrier » est un choix explicite : on n'y
// touche pas. La refacturation d'avance de fonds coche elle-même mail + Peppol (avance-mail.ts) : elle n'est pas concernée.
import { odooRpcCompany, ODOO_COMPANIES } from '@/lib/odoo'

/** N° de TVA belge : « BE » facultatif + 10 chiffres commençant par 0 ou 1 (souvent encodé sans préfixe : 0206.731.645). */
export function tvaBelge(vat: string | null | undefined): boolean {
  return /^(BE)?[01]\d{9}$/.test(String(vat || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
}

export async function aligneEnvoiPeppol(): Promise<{ societe: string; corriges: string[] }[]> {
  const out: { societe: string; corriges: string[] }[] = []
  for (const [societe, company] of Object.entries(ODOO_COMPANIES)) {
    const tous: any[] = await odooRpcCompany(company, 'res.partner', 'search_read',
      [[['peppol_verification_state', '=', 'valid'], '|', ['invoice_sending_method', '=', false], ['invoice_sending_method', '=', 'email']]],
      { fields: ['id', 'name', 'commercial_partner_id'], context: { active_test: false } })
    const cps: any[] = tous.length ? await odooRpcCompany(company, 'res.partner', 'read', [[...new Set(tous.map(p => p.commercial_partner_id[0]))]], { fields: ['vat'] }) : []
    const belge = new Set(cps.filter(c => tvaBelge(c.vat)).map(c => c.id))
    const ps = tous.filter(p => belge.has(p.commercial_partner_id[0]))
    if (ps.length) await odooRpcCompany(company, 'res.partner', 'write', [ps.map(p => p.id), { invoice_sending_method: 'peppol' }])
    out.push({ societe, corriges: ps.map(p => p.name) })
  }
  return out
}

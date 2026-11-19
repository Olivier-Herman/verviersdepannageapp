// src/lib/facturation/peppol-envoi.ts — un client inscrit sur Peppol, belge ou étranger, reçoit ses factures par Peppol seul
// (Olivier 19/11/2026 : « si inscrit sur Peppol même étranger, pas de soucis on envoie par Peppol » ; le réglage de la fiche
// suit l'envoi automatique de VD Soft). Un client qui n'est pas inscrit sur Peppol garde le mail.
//
// Le réglage « Envoi des factures » de la fiche client (res.partner.invoice_sending_method, propre à chaque société)
// décide des cases cochées par défaut quand on envoie une facture depuis l'ERP. Vide ou « par e-mail » : le mail est
// coché, et le client reçoit la facture en double (Allianz les refusait). Chaque nuit, toute fiche inscrite sur Peppol
// encore réglée « par e-mail » ou sans réglage passe en « par Peppol ». « Par courrier » est un choix explicite : on n'y
// touche pas. La refacturation d'avance de fonds coche elle-même mail + Peppol (avance-mail.ts) : elle n'est pas concernée.
import { odooRpcCompany, ODOO_COMPANIES } from '@/lib/odoo'

export async function aligneEnvoiPeppol(): Promise<{ societe: string; corriges: string[] }[]> {
  const out: { societe: string; corriges: string[] }[] = []
  for (const [societe, company] of Object.entries(ODOO_COMPANIES)) {
    const ps: any[] = await odooRpcCompany(company, 'res.partner', 'search_read',
      [[['peppol_verification_state', '=', 'valid'], '|', ['invoice_sending_method', '=', false], ['invoice_sending_method', '=', 'email']]],
      { fields: ['id', 'name'], context: { active_test: false } })
    if (ps.length) await odooRpcCompany(company, 'res.partner', 'write', [ps.map(p => p.id), { invoice_sending_method: 'peppol' }])
    out.push({ societe, corriges: ps.map(p => p.name) })
  }
  return out
}

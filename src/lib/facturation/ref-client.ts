// src/lib/facturation/ref-client.ts
//
// Référence client d'une facture d'assistance (Olivier 22/10/2026, après la non-conformité des
// factures IMA, étendu à toutes les assistances) : la facture porte UN SEUL numéro de mission ou de
// dossier de l'assistance, rien d'autre — ni nos numéros internes (« ACC-… », « SNC-… », « SAISIE-… »),
// ni le suffixe « -REL » de nos relivraisons, ni un deuxième numéro, ni une remarque.
//   - IMA (Ethias, P&V, IMA Benelux…) : B61185450AA → B61185450, on s'arrête avant le suffixe AA / AB ;
//   - les autres : le premier numéro de l'assistance (VAB 8453064/35264110, AXA 0126568240, AWP 202603863367…).
// Une référence sans numéro d'assistance reconnaissable (Parquet « ROJ-… », commissions, Domaine,
// « Votre numéro d'accord … », « MAN_… ») passe inchangée, comme une référence déjà propre.

const MISSION_IMA = /(?<![0-9A-Z])([BF]\d[0-9A-Z]\d{6})(?:[A-Z]{2})?(?![0-9A-Z])/
const INTERNE = /^(ACC|SNC|SAISIE)-\d+$/i
const PV = /^VE\./i

/** Numéro en tête d'un morceau : lettres, chiffres, « / » et « . », au moins 6 chiffres. */
function numeroEnTete(part: string): string | null {
  const m = /^[A-Z0-9][A-Z0-9/.]*/i.exec(part.trim())
  if (!m || (m[0].match(/\d/g) || []).length < 6 || PV.test(m[0])) return null
  return m[0].replace(/[/.]+$/, '')
}

/** Règle IMA, valable pour toute facture : le seul numéro de mission, sans suffixe. Sinon inchangé. */
export function refIma<T extends string | null | undefined>(raw: T): T | string {
  if (!raw) return raw
  const ima = MISSION_IMA.exec(String(raw).replace(/\s+/g, ' '))
  return ima ? ima[1] : raw
}

/** Règle des assistances : le premier numéro de l'assistance, sans nos numéros internes ni remarque. */
export function refAssistance<T extends string | null | undefined>(raw: T): T | string {
  if (!raw) return raw
  const s = String(raw).replace(/\s+/g, ' ').trim()
  const ima = MISSION_IMA.exec(s)
  if (ima) return ima[1]
  const parts = s.split(/ \/ | - /).map(p => p.trim().replace(/(-REL)+$/i, '')).filter(p => p && !INTERNE.test(p))
  for (const p of parts) {
    const n = numeroEnTete(p)
    if (n) return n
  }
  return raw
}

/**
 * Référence à poser sur un devis / une facture : règle des assistances si le client (sa société)
 * est dans le réglage « facture_ref_assistances », sinon seulement la règle IMA.
 */
export async function refFacture(raw: string | null | undefined, partnerId?: number | null): Promise<string | null | undefined> {
  if (!raw) return raw
  if (partnerId) {
    try {
      const { getBusinessList } = await import('@/lib/settings/business')
      const ids = new Set((await getBusinessList('facture_ref_assistances')).map(String))
      let company = String(partnerId)
      if (!ids.has(company)) {
        const { odooRpc } = await import('@/lib/odoo')
        const [p]: any[] = await odooRpc('res.partner', 'read', [[partnerId]], { fields: ['commercial_partner_id'] })
        company = String(p?.commercial_partner_id?.[0] || partnerId)
      }
      if (ids.has(company)) return refAssistance(raw)
    } catch { /* réglage ou ERP indisponible : règle IMA seule */ }
  }
  return refIma(raw)
}

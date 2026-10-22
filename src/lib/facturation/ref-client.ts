// src/lib/facturation/ref-client.ts
//
// Référence client d'une facture (Olivier 22/10/2026, non-conformité des factures IMA) :
// quand la référence contient un numéro de mission IMA (B61185450AA, B5E372307AB, F63276600AA…),
// la facture ne porte QUE ce numéro, sans le suffixe AA / AB, sans « ACC-… », « -REL », second
// numéro ni remarque. Sinon IMA ne rattache pas la facture et ne la paie pas.
// Les autres références (Touring, VAB, AXA…) passent inchangées.

const MISSION_IMA = /(?<![0-9A-Z])([BF]\d[0-9A-Z]\d{6})(?:[A-Z]{2})?(?![0-9A-Z])/

export function refClient<T extends string | null | undefined>(raw: T): T | string {
  if (!raw) return raw
  const m = MISSION_IMA.exec(String(raw))
  return m ? m[1] : raw
}

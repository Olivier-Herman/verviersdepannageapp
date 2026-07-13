// src/lib/payments/epc-qr.ts
//
// Génère le PAYLOAD d'un QR EPC (SEPA Credit Transfer / « Girocode »), scannable
// par la plupart des apps bancaires belges (KBC, Belfius, ING, BNP…) pour
// pré-remplir un virement vers notre compte. Plan B quand SumUp est down.
// Olivier 2026-07-13.

export interface EpcQrInput {
  name:        string   // bénéficiaire (max 70)
  iban:        string
  bic?:        string
  amount:      number   // EUR, > 0
  remittance?: string   // communication libre (max 140)
}

/** Construit la chaîne EPC (version 002). Passer à QRCode.toDataURL pour l'image. */
export function buildEpcQrPayload(o: EpcQrInput): string {
  const iban  = (o.iban || '').replace(/\s+/g, '').toUpperCase()
  const bic   = (o.bic  || '').replace(/\s+/g, '').toUpperCase()
  const name  = (o.name || '').slice(0, 70)
  const amt   = `EUR${(Math.round(o.amount * 100) / 100).toFixed(2)}`
  const remit = (o.remittance || '').slice(0, 140)
  return [
    'BCD',   // Service Tag
    '002',   // Version
    '1',     // Charset UTF-8
    'SCT',   // SEPA Credit Transfer
    bic,     // BIC (optionnel en v002)
    name,    // Bénéficiaire
    iban,    // IBAN
    amt,     // Montant EUR#.##
    '',      // Purpose (optionnel)
    '',      // Référence structurée (optionnel)
    remit,   // Communication libre
  ].join('\n')
}

export function bankConfigFromEnv(): { name: string; iban: string; bic: string } | null {
  const iban = process.env.NEXT_PUBLIC_BANK_IBAN || ''
  const name = process.env.NEXT_PUBLIC_BANK_NAME || 'Verviers Dépannage'
  const bic  = process.env.NEXT_PUBLIC_BANK_BIC  || ''
  if (!iban.trim()) return null
  return { name, iban, bic }
}

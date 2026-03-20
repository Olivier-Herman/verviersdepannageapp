// ============================================================
// VERVIERS DÉPANNAGE — VIES API (validation TVA EU)
// https://ec.europa.eu/taxation_customs/vies/
// ============================================================

export interface ViesResponse {
  valid: boolean
  name?: string
  address?: string
  vatNumber?: string
  countryCode?: string
  error?: string
}

export async function checkVat(vatNumber: string): Promise<ViesResponse> {
  // Nettoyer le numéro — supprimer espaces, points, tirets
  const cleaned = vatNumber.replace(/[\s.\-]/g, '').toUpperCase()

  // Extraire le code pays (2 lettres) et le numéro
  const countryCode = cleaned.substring(0, 2)
  const number = cleaned.substring(2)

  if (countryCode.length !== 2 || number.length < 4) {
    return { valid: false, error: 'Format invalide. Ex: BE0460759205' }
  }

  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${number}`,
      { next: { revalidate: 3600 } }  // Cache 1h côté Next.js
    )

    if (!res.ok) {
      if (res.status === 404) return { valid: false, error: 'Numéro de TVA introuvable' }
      throw new Error(`VIES HTTP error: ${res.status}`)
    }

    const data = await res.json()

    return {
      valid: data.isValid === true,
      name: data.name !== '---' ? data.name : undefined,
      address: data.address !== '---' ? data.address : undefined,
      vatNumber: cleaned,
      countryCode
    }
  } catch (err: any) {
    console.error('VIES error:', err)
    return { valid: false, error: 'Service VIES temporairement indisponible' }
  }
}

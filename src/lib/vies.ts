// ============================================================
// VERVIERS DÉPANNAGE — VIES API (validation TVA EU)
// https://ec.europa.eu/taxation_customs/vies/
// ============================================================

export interface ViesResponse {
  valid: boolean
  /** true = VIES/État membre indisponible : numéro NON confirmé (≠ invalide) */
  unverified?: boolean
  name?: string
  address?: string
  vatNumber?: string
  countryCode?: string
  error?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function checkVat(vatNumber: string): Promise<ViesResponse> {
  // Nettoyer le numéro — supprimer espaces, points, tirets
  const cleaned = vatNumber.replace(/[\s.\-]/g, '').toUpperCase()

  // Extraire le code pays (2 lettres) et le numéro
  const countryCode = cleaned.substring(0, 2)
  const number = cleaned.substring(2)

  if (countryCode.length !== 2 || number.length < 4) {
    return { valid: false, error: 'Format invalide. Ex: BE0460759205' }
  }

  // VIES/État membre renvoie souvent des erreurs TRANSITOIRES (service saturé,
  // indisponible, timeout) avec isValid=false alors que le numéro est valide.
  // Olivier 2026-07-06 (cas BE0788846164 → userError MS_MAX_CONCURRENT_REQ) :
  //   - on ne cache PAS les réponses (sinon un échec transitoire reste figé 1h) ;
  //   - on RETENTE quelques fois sur ces erreurs (le 2e essai passe souvent) ;
  //   - si ça ne se confirme toujours pas → unverified (≠ invalide), on ne
  //     dit jamais « TVA invalide » sur un numéro qu'on n'a pas pu vérifier.
  // Un userError = 'INVALID' (ou un 404) reste le SEUL vrai « numéro invalide ».
  const TRANSIENT = new Set([
    'MS_MAX_CONCURRENT_REQ', 'GLOBAL_MAX_CONCURRENT_REQ', 'MS_UNAVAILABLE',
    'SERVICE_UNAVAILABLE', 'TIMEOUT', 'SERVER_BUSY', 'BATCH_INTERNAL_ERROR',
  ])
  const MAX_ATTEMPTS = 3
  let lastTransient: string | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${number}`,
        { cache: 'no-store' },
      )

      if (!res.ok) {
        if (res.status === 404) return { valid: false, vatNumber: cleaned, countryCode, error: 'Numéro de TVA introuvable' }
        // 5xx/429 : transitoire → on retente
        lastTransient = `HTTP ${res.status}`
        if (attempt < MAX_ATTEMPTS) { await sleep(attempt * 500); continue }
        break
      }

      const data = await res.json()

      if (data.isValid === true) {
        return {
          valid: true,
          name:    data.name    && data.name    !== '---' ? data.name    : undefined,
          address: data.address && data.address !== '---' ? data.address : undefined,
          vatNumber: cleaned,
          countryCode,
        }
      }

      const userError = String(data.userError || '').toUpperCase()
      if (userError && userError !== 'INVALID' && userError !== 'VALID') {
        // Erreur transitoire (ex: MS_MAX_CONCURRENT_REQ) → retente puis unverified
        lastTransient = userError
        if (attempt < MAX_ATTEMPTS) { await sleep(attempt * 500); continue }
        break
      }

      // isValid=false + userError INVALID (ou absent) = numéro réellement invalide
      return { valid: false, vatNumber: cleaned, countryCode, error: 'Numéro de TVA invalide' }
    } catch (err: any) {
      lastTransient = err?.message || 'network'
      if (attempt < MAX_ATTEMPTS) { await sleep(attempt * 500); continue }
    }
  }

  console.warn(`[VIES] non confirmé pour ${cleaned} (${lastTransient})`)
  return {
    valid: false,
    unverified: true,
    vatNumber: cleaned,
    countryCode,
    error: 'Vérification VIES momentanément indisponible — numéro non confirmé (tu peux quand même continuer).',
  }
}

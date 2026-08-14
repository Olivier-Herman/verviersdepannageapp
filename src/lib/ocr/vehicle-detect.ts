// src/lib/ocr/vehicle-detect.ts
//
// Détection PLAQUE + VIN + KILOMÉTRAGE depuis des photos (Claude Haiku vision, multi-images en
// un appel). Cœur PARTAGÉ entre la route /ocr-vehicle (confirmation chauffeur à
// la clôture) et l'action `park` (filet auto à la mise en parc). Ne renvoie que
// des valeurs VALIDÉES (format plaque / VIN 17 car.) — jamais inventé.
// Olivier 2026-07-13 · kilométrage ajouté le 2026-08-11 (Franck : « les km ne se
// sont pas complétés malgré ma photo » — le compteur est photographié, autant le
// lire). Champ OPTIONNEL : les appelants existants ignorent simplement `mileage`.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_CHEAP_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { looksLikePlate, looksLikeVin, normalizeOcr } from '@/lib/ocr/vehicle'

const OCR_MODELS = [process.env.ANTHROPIC_OCR_MODEL, ...ANTHROPIC_CHEAP_MODELS].filter(Boolean) as string[]
// Les chauffeurs ne classent pas leurs photos — elles arrivent toutes en
// « autre » — donc c'est à nous de retrouver le châssis et le compteur DANS le
// lot (Olivier 2026-08-14). À six images, une mission qui en compte huit voyait
// les premières ignorées : Franck avait cinq photos sur 1UXZ479 et l'écran lui
// redemandait quand même le châssis.
const MAX_IMAGES = 12

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant en env vars')
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

const SYSTEM_PROMPT = `Tu extrais la PLAQUE D'IMMATRICULATION, le VIN (numéro de châssis) et le KILOMÉTRAGE d'un véhicule à partir de photos prises par un dépanneur. Tu reçois plusieurs images numérotées (1, 2, 3...).

Retourne UNIQUEMENT un JSON strict, sans markdown, sans commentaire :
{ "plate":   { "value": "<plaque>", "image": <numéro 1..N> } | null,
  "vin":     { "value": "<VIN 17 caractères>", "image": <numéro 1..N> } | null,
  "mileage": { "value": <nombre entier>, "image": <numéro 1..N> } | null }

Règles STRICTES :
- VIN = EXACTEMENT 17 caractères (lettres + chiffres, JAMAIS de I, O ni Q). Si tu ne lis pas un VIN complet et net de 17 caractères, mets null. Ne DEVINE JAMAIS.
- Plaque = plaque d'immatriculation du véhicule (format belge, lettres + chiffres). Si non lisible clairement, null.
- KILOMÉTRAGE = l'odomètre TOTAL lu sur le tableau de bord (compteur), en chiffres, SANS séparateur ni unité.
  · Ne confonds PAS avec le trip/journalier (souvent précédé de "TRIP"/"A"/"B" et avec une décimale), la vitesse, la température, l'heure ou l'autonomie.
  · Le total est l'entier le plus grand affiché, généralement suivi de "km".
  · Si le compteur n'est pas net et lisible en entier, mets null. Ne DEVINE JAMAIS un chiffre.
- "image" = le numéro de la photo (1..N) où tu as lu la valeur.
- Dans le doute, préfère null plutôt qu'une valeur approximative.

ORIENTATION (Olivier 2026-08-12) : les photos sont prises au téléphone, souvent
de biais ou en portrait devant une étiquette posée à l'horizontale. Le texte peut
donc apparaître TOURNÉ à 90° ou 180°, en biais, sombre ou avec des reflets.
Lis-le quand même — un VIN à la verticale reste un VIN. Le châssis se trouve sur
la plaque constructeur (montant de portière, bas de pare-brise, compartiment
moteur) ; sur ces plaques il est la LONGUE suite de 17 caractères, à côté du nom
du constructeur et des masses en kg (3500 kg, 1650 kg…), qui ne sont PAS le VIN.

OÙ LE CHERCHER AUSSI — LE CERTIFICAT D'IMMATRICULATION (Olivier 2026-08-14) :
c'est l'endroit que les dépanneurs photographient le plus souvent, posé sur le
tableau de bord ou derrière le pare-brise. Carte rose/verte intitulée
« Kentekenbewijs Deel I », « Certificat d'immatriculation Partie I »,
« Zulassungsbescheinigung Teil I ». Le VIN y est imprimé EN CLAIR au repère
« E. VIN », encadré, sous la date de première inscription. La plaque est en haut
au repère A. Un suffixe entre parenthèses après le VIN — « (01) », « (1) » — est
un code de contrôle : IGNORE-LE et ne renvoie que les 17 caractères.`

export interface VehicleOcrHit { value: string; image: number }
export interface VehicleOcrKmHit { value: number; image: number }
export interface VehicleOcrResult {
  plate: VehicleOcrHit | null
  vin: VehicleOcrHit | null
  /** Kilométrage total lu au compteur (optionnel — null si non lisible). */
  mileage?: VehicleOcrKmHit | null
}

/**
 * `rawImages` = tableau de data-URL/base64 (capture locale) OU d'URL http (photos
 * déjà uploadées). Retourne { plate, vin } validés (ou null chacun). Ne throw
 * jamais pour un souci de photo : renvoie null. Peut throw si Claude/API échoue.
 */
export async function detectVehicleFromImages(rawImages: (string | null | undefined)[]): Promise<VehicleOcrResult> {
  const raw = (rawImages || []).map(s => String(s || '').trim()).filter(Boolean).slice(0, MAX_IMAGES)
  if (raw.length === 0) return { plate: null, vin: null, mileage: null }

  // Anthropic n'accepte que jpeg/png/gif/webp — envoyer un mauvais media_type
  // (ex. jpeg codé en dur pour un PNG) casse le décodage → aucun OCR. On déduit
  // donc le type de l'en-tête HTTP / de l'extension / du préfixe data-URL.
  const SUPPORTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const mediaFromExt = (url: string): string => {
    const u = url.toLowerCase()
    if (u.includes('.png')) return 'image/png'
    if (u.includes('.webp')) return 'image/webp'
    if (u.includes('.gif')) return 'image/gif'
    return 'image/jpeg'
  }
  const norm = (m: string | null | undefined): string => {
    const v = (m || '').toLowerCase().split(';')[0].trim()
    return SUPPORTED.includes(v) ? v : 'image/jpeg'
  }

  const images: { data: string; media: string }[] = []
  for (const item of raw) {
    if (/^https?:\/\//i.test(item)) {
      try {
        const r = await fetch(item)
        if (!r.ok) continue
        const media = norm(r.headers.get('content-type')) || mediaFromExt(item)
        images.push({ data: Buffer.from(await r.arrayBuffer()).toString('base64'), media })
      } catch { /* photo injoignable → ignorée */ }
    } else {
      const m = item.match(/^data:([^;,]+)[;,]/)
      images.push({ data: item.replace(/^data:[^,]+,/, ''), media: norm(m?.[1]) })
    }
  }
  if (images.length === 0) return { plate: null, vin: null, mileage: null }

  const client = getClient()
  const content: any[] = images.map(({ data, media }) => ({
    type: 'image', source: { type: 'base64', media_type: media, data },
  }))
  content.push({ type: 'text', text: `Voici ${images.length} photo(s). Extrais plaque + VIN + kilométrage. JSON strict uniquement.` })

  const resp = await createWithModelFallback(client, OCR_MODELS, {
    max_tokens: 300,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content }],
  })

  const text = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  let parsed: any
  try { parsed = JSON.parse(cleaned) } catch {
    console.error('[vehicle-detect] JSON parse fail:', text.slice(0, 300))
    return { plate: null, vin: null, mileage: null }
  }

  const validate = (obj: any, kind: 'plate' | 'vin'): VehicleOcrHit | null => {
    if (!obj || typeof obj.value !== 'string') return null
    const v = normalizeOcr(obj.value, kind)
    const ok = kind === 'plate' ? looksLikePlate(v) : looksLikeVin(v)
    if (!ok) return null
    const img = Number(obj.image)
    const image = Number.isFinite(img) && img >= 1 && img <= images.length ? img : 1
    return { value: v, image }
  }

  // Kilométrage : entier plausible uniquement (0 exclu, 2 000 000 km = borne haute
  // large mais qui écarte une lecture de VIN ou d'heure prise pour un compteur).
  const validateKm = (obj: any): VehicleOcrKmHit | null => {
    if (!obj) return null
    const n = Math.round(Number(String(obj.value ?? '').toString().replace(/[^0-9]/g, '')))
    if (!Number.isFinite(n) || n <= 0 || n > 2_000_000) return null
    const img = Number(obj.image)
    const image = Number.isFinite(img) && img >= 1 && img <= images.length ? img : 1
    return { value: n, image }
  }

  const result: VehicleOcrResult = {
    plate:   validate(parsed.plate, 'plate'),
    vin:     validate(parsed.vin, 'vin'),
    mileage: validateKm(parsed.mileage),
  }

  // Deuxième passe, VIN SEUL. Vu en réel le 12/08 (VAB 2GHQ619, Sprinter) : la
  // plaque constructeur était nette sur la photo, mais tournée à 90° — noyée dans
  // une demande qui cherchait aussi la plaque et le compteur, le VIN est ressorti
  // null. Une question unique, sur les mêmes images, le retrouve. On ne relance
  // que si le premier passage n'a rien donné : coût nul dans le cas normal.
  if (!result.vin) {
    try {
      const retry = await createWithModelFallback(client, OCR_MODELS, {
        max_tokens: 120,
        system: `Tu cherches UNIQUEMENT le VIN (numéro de châssis) sur des photos de véhicule.
Le VIN fait EXACTEMENT 17 caractères (jamais de I, O ni Q). Il est estampé sur la plaque
constructeur, gravé sur le châssis, OU imprimé en clair au repère « E. VIN » du certificat
d'immatriculation (« Kentekenbewijs Deel I » / « Certificat d'immatriculation Partie I »),
que les dépanneurs photographient très souvent sur le tableau de bord. Un suffixe entre
parenthèses — « (01) » — est un code de contrôle : ignore-le, renvoie les 17 caractères.
Les photos peuvent être TOURNÉES (90°/180°), sombres
ou avec des reflets : lis quand même. Ne confonds pas avec les masses en kg, le numéro
d'homologation (e1*...) ni le type du véhicule.
Réponds UNIQUEMENT : {"vin":{"value":"<17 caractères>","image":<n>}} ou {"vin":null}.
Si tu ne lis pas les 17 caractères en entier, réponds null. Ne DEVINE JAMAIS.`,
        messages: [{ role: 'user', content: [
          ...images.map(({ data, media }) => ({ type: 'image', source: { type: 'base64', media_type: media, data } })),
          { type: 'text', text: `Voici ${images.length} photo(s). Trouve le VIN. JSON strict uniquement.` },
        ] }],
      })
      const t = retry.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
      const p2 = JSON.parse(t)
      result.vin = validate(p2?.vin, 'vin')
    } catch { /* la 2e passe est un bonus : son échec ne change rien */ }
  }

  return result
}

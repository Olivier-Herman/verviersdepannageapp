// src/lib/ocr/vehicle.ts
//
// Helpers OCR véhicule (plaque / VIN) partagés — extraits de OcrScanModal pour
// être réutilisés par l'auto-détection à la PRISE de photo (option A : natif,
// iOS Apple Vision + Android ML Kit, 0 €). Olivier 2026-07-10.

// Caractères autorisés pour un VIN ISO 3779 : A-Z sans I, O, Q + chiffres.
const VIN_ALLOWED_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

export function normalizeOcr(raw: string, mode: 'plate' | 'vin'): string {
  const u = raw.toUpperCase().trim()
  if (mode === 'vin') return [...u].filter(c => VIN_ALLOWED_CHARS.includes(c)).join('')
  return u.replace(/[^A-Z0-9\- ]/g, '').replace(/\s+/g, ' ')
}

/** True si le candidat ressemble à une plaque (mix lettre + chiffre, 4-12 chars). */
export function looksLikePlate(s: string): boolean {
  const clean = s.replace(/[\s-]/g, '')
  if (clean.length < 4 || clean.length > 12) return false
  return /[A-Z]/.test(clean) && /[0-9]/.test(clean)
}

/** True si le candidat respecte la norme VIN ISO 3779 (17 chars sans I/O/Q). */
export function looksLikeVin(s: string): boolean {
  if (s.length !== 17) return false
  for (const c of s) if (!VIN_ALLOWED_CHARS.includes(c)) return false
  return true
}

/**
 * Lance l'OCR NATIF (Apple Vision sur iOS, ML Kit sur Android) sur un fichier
 * local (chemin capacitor) et en extrait plaque + VIN valides. Retourne null
 * pour un champ non trouvé. Web / non-natif / erreur → { plate:null, vin:null }
 * (jamais d'exception, jamais de valeur inventée).
 */
export async function detectVehicleFromFile(
  filename: string,
): Promise<{ plate: string | null; vin: string | null }> {
  const empty = { plate: null as string | null, vin: null as string | null }
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return empty
    const platform = Capacitor.getPlatform()

    let raw: { text: string }[] = []
    if (platform === 'android') {
      const { Ocr } = await import('@capacitor-community/image-to-text')
      const data = await Ocr.detectText({ filename })
      raw = (data.textDetections || []).map((d: any) => ({ text: d.text }))
    } else {
      const TextRecognition = registerPlugin<{
        detectText(o: { filename: string }): Promise<{ textDetections: { text: string }[] }>
      }>('TextRecognition')
      const data = await TextRecognition.detectText({ filename })
      raw = data.textDetections || []
    }

    // Plaque : 1re détection au format plaque.
    let plate: string | null = null
    for (const d of raw) {
      const np = normalizeOcr(d.text, 'plate')
      if (looksLikePlate(np)) { plate = np; break }
    }

    // VIN : détection directe (17 valides) puis sous-chaîne 17 dans le texte
    // concaténé (l'OCR découpe souvent le VIN en morceaux sur la plaquette).
    let vin: string | null = null
    for (const d of raw) {
      const nv = normalizeOcr(d.text, 'vin')
      if (looksLikeVin(nv)) { vin = nv; break }
    }
    if (!vin) {
      const full = raw.map(d => normalizeOcr(d.text, 'vin')).join('')
      for (let i = 0; i + 17 <= full.length; i++) {
        const sub = full.substring(i, i + 17)
        if (looksLikeVin(sub)) { vin = sub; break }
      }
    }

    return { plate, vin }
  } catch { return empty }
}

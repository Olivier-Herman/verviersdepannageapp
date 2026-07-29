// src/lib/domaine/parse-dates-in.ts
//
// Parse un mail « Dates IN » du SPF Finances (Domaine, rosemarie.lehnen@minfin.fed.be) :
// des blocs DATE (JJ/MM/AAAA) suivis chacun d'une liste de véhicules jusqu'à la
// date suivante. Chaque ligne véhicule :
//   « Peugeot 407 - n° de châssis : VF36ERHRH21163796 (PV de remise Antoine Desmedt) »
// → { remiseDate, brand, model, vin, pvName }. Olivier 2026-07-29.

export interface DatesInEntry {
  remiseDate: string          // AAAA-MM-JJ (date de remise au Domaine)
  vehicle:    string          // libellé brut « Peugeot 407 »
  brand:      string | null
  model:      string | null
  vin:        string          // n° de châssis complet
  vinTail:    string          // 5 derniers (clé de match)
  pvName:     string | null   // nom sur le PV de remise
}

/** HTML → texte : conserve les sauts de ligne, retire les balises, décode les entités. */
function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
// « Marque Modèle - n° de châssis : VIN (PV de remise NOM) » — tolère °/º, accents, tirets.
const VEH_RE = /^(.+?)\s*[-–—]\s*n[°ºo]?\s*de\s*ch[aâ]ssis\s*:?\s*([A-Za-z0-9]{6,})\s*(?:\(\s*pv\s*de\s*remise\s*(.+?)\s*\)\s*)?$/i

export function parseDatesIn(input: { content: string; contentType?: 'html' | 'text' }): DatesInEntry[] {
  const text = input.contentType === 'html' ? htmlToText(input.content) : String(input.content || '')
  const lines = text.split(/\r?\n/)
  const out: DatesInEntry[] = []
  let currentDate: string | null = null

  for (const raw of lines) {
    const line = raw.replace(/ /g, ' ').trim()
    if (!line) continue

    const dm = line.match(DATE_RE)
    if (dm) { currentDate = `${dm[3]}-${dm[2]}-${dm[1]}`; continue }

    if (!currentDate) continue
    const vm = line.match(VEH_RE)
    if (!vm) continue

    const vehicle = vm[1].trim()
    const vin = vm[2].trim().toUpperCase()
    const pvName = (vm[3] || '').trim() || null
    const parts = vehicle.split(/\s+/)
    out.push({
      remiseDate: currentDate,
      vehicle,
      brand: parts[0] || null,
      model: parts.slice(1).join(' ') || null,
      vin,
      vinTail: vin.length >= 5 ? vin.slice(-5) : vin,
      pvName,
    })
  }
  return out
}

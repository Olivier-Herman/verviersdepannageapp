// src/lib/domaine/parse-vente-epaves.ts
//
// Parse un mail « Vente d'épaves » du SPF Finances (Domaine,
// rosemarie.lehnen@minfin.fed.be). Structure :
//   « … vendu … à la firme <FIRME> les véhicules suivants … »
//   [tableau] N° | Marque Modèle | Châssis (photos…) | Date | CP | Ville | Rue | …
//   « La date maximale pour l'enlèvement a été fixée au JJ.MM.AAAA. »
// → { firm, maxEnlevementDate (YYYY-MM-DD), vehicles[] }. Olivier 2026-07-29.

export interface VenteEpaveVehicle {
  numero:    string | null   // N° véhicule du mail (201, 208, …)
  vehicle:   string          // libellé brut « Citroën Berlingo »
  brand:     string | null
  model:     string | null
  vin:       string          // n° de châssis complet
  vinTail:   string          // 5 derniers (clé de match)
  emailDate: string | null   // date de la colonne du mail (YYYY-MM-DD) — informatif
}

export interface VenteEpaveParsed {
  firm:               string | null
  maxEnlevementDate:  string | null   // YYYY-MM-DD (= Date OUT)
  vehicles:           VenteEpaveVehicle[]
}

/** HTML → texte : conserve les sauts de ligne, retire les balises, décode les entités. */
function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/td|\/th)\s*\/?>/gi, ' \n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

const cellText = (html: string) =>
  htmlToText(html).replace(/\s+/g, ' ').replace(/ /g, ' ').trim()

/** Découpe un HTML de tableau en lignes de cellules. */
function parseTableRows(html: string): string[][] {
  const rows: string[][] = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let tr: RegExpExecArray | null
  while ((tr = trRe.exec(html))) {
    const cells: string[] = []
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let td: RegExpExecArray | null
    while ((td = tdRe.exec(tr[1]))) cells.push(cellText(td[1]))
    if (cells.some(c => c)) rows.push(cells)
  }
  return rows
}

// VIN : 11 à 17 caractères alphanumériques, au moins une lettre ET un chiffre.
const VIN_RE = /\b([A-HJ-NPR-Z0-9]{11,17})\b/i
const hasLetterDigit = (s: string) => /[A-Z]/i.test(s) && /[0-9]/.test(s)

/** Parse une date JJ.MM.AAAA / JJ/MM/AAAA / JJ-MM-AA(AA) → YYYY-MM-DD. */
function parseDate(s: string | null | undefined): string | null {
  const m = String(s || '').match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/)
  if (!m) return null
  const dd = m[1].padStart(2, '0')
  const mm = m[2].padStart(2, '0')
  let yy = m[3]
  if (yy.length === 2) yy = `20${yy}`
  return `${yy}-${mm}-${dd}`
}

export function parseVenteEpaves(input: { content: string; contentType?: 'html' | 'text' }): VenteEpaveParsed {
  const isHtml = input.contentType === 'html'
  const text = isHtml ? htmlToText(input.content) : String(input.content || '')

  // Firme gagnante : « à la firme <X> les véhicules suivants ».
  let firm: string | null = null
  // Le connecteur avant « véhicules » est tolérant : « les », coquille « es »,
  // « des »… (mails SPF pas toujours propres). Requis pour ne pas manger le
  // dernier mot du nom de firme.
  const fm = text.match(/(?:à|a)\s+la\s+firme\s+(.+?)\s+\S{1,4}\s+v[ée]hicules?\s+suivants?/i)
  if (fm) firm = fm[1].replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim()

  // Date maximale d'enlèvement (= Date OUT), valable pour tout le lot.
  let maxEnlevementDate: string | null = null
  const em = text.match(/date\s+maximale\s+pour\s+l['’\s]*enl[èe]vement[^0-9]*(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4})/i)
  if (em) maxEnlevementDate = parseDate(em[1])

  // Véhicules : depuis les lignes de tableau (HTML), sinon fallback texte.
  const vehicles: VenteEpaveVehicle[] = []
  const seen = new Set<string>()

  const pushVehicle = (numero: string | null, label: string, vin: string, emailDate: string | null) => {
    const upper = vin.toUpperCase()
    if (seen.has(upper)) return
    seen.add(upper)
    const clean = label.replace(/\s+/g, ' ').trim()
    const parts = clean.split(/\s+/)
    vehicles.push({
      numero: numero && numero.trim() ? numero.trim() : null,
      vehicle: clean,
      brand: parts[0] || null,
      model: parts.slice(1).join(' ') || null,
      vin: upper,
      vinTail: upper.length >= 5 ? upper.slice(-5) : upper,
      emailDate,
    })
  }

  if (isHtml && /<tr[\s>]/i.test(input.content)) {
    for (const cells of parseTableRows(input.content)) {
      // Cellule contenant un VIN.
      let vinIdx = -1, vin = ''
      for (let i = 0; i < cells.length; i++) {
        const m = cells[i].match(VIN_RE)
        if (m && hasLetterDigit(m[1])) { vinIdx = i; vin = m[1]; break }
      }
      if (vinIdx < 0) continue   // ligne d'en-tête / vide
      // N° = 1re cellule courte numérique ; libellé = cellule avant le VIN.
      const numero = /^\d{1,5}$/.test(cells[0]) ? cells[0] : null
      const label = (vinIdx >= 1 ? cells[vinIdx - 1] : cells[0]) || ''
      // Date : 1re cellule après le VIN qui ressemble à une date.
      let emailDate: string | null = null
      for (let i = vinIdx + 1; i < cells.length; i++) {
        const d = parseDate(cells[i])
        if (d) { emailDate = d; break }
      }
      pushVehicle(numero, label, vin, emailDate)
    }
  }

  return { firm, maxEnlevementDate, vehicles }
}
